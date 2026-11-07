import vscode from 'vscode';
import { isDeepStrictEqual } from 'util';
import type { AuthStatus } from '../centralized-webview-framework/types/auth';
import type { ServerMetadata } from '../devtools-api/ide-server-client';
import { logOutputChannel } from '../log';
import {
  EMPTY_ACCOUNT_DATA,
  fetchAccountData,
  fetchProjectLink,
  linkFields,
  NO_LINK,
  type AccountData,
} from './account-data';
import { IDLE_FLOW, nextStep, type FlowState } from './auth-flow';
import { accountDataKey, INACTIVE_SNAPSHOT, type AuthRepo, type AuthSnapshot } from './auth-payload';
import { authErrorCode, AuthRpc, isMethodNotFound } from './auth-rpc';
import { authConfiguration, type AuthSettings } from './auth-settings';
import { reauthorizeFailed, signInFailed, signInOutcome, type AuthTelemetryEvent } from './auth-telemetry';
import type { AuthTransport } from './auth-transport';

export const AUTH_CAPABILITY = 'auth-v1';

const MANUAL_FLOW_KINDS = { account: 'manual-account', project: 'manual-project' } as const;

function flowKindFor(screen: unknown): FlowState['kind'] {
  return screen === 'account' || screen === 'project' ? MANUAL_FLOW_KINDS[screen] : 'idle';
}

export interface AuthServiceDeps {
  transport: AuthTransport;
  settings: AuthSettings;
  openExternal: (url: string) => Thenable<unknown>;
  logUsage: (name: string, data?: Record<string, unknown>) => void;
}

export class AuthService implements vscode.Disposable {
  private readonly rpc: AuthRpc;
  private readonly emitter = new vscode.EventEmitter<AuthSnapshot>();
  private readonly disposables: vscode.Disposable[] = [];
  private snapshot: AuthSnapshot = INACTIVE_SNAPSHOT;
  private capable = false;
  private enabled = false;
  private optedIn = false;
  private startHandled = false;
  private syncOnSignIn = false;
  private syncSupported = true;
  private configureSeq = 0;
  private loadedKey: string | undefined;
  private accountLoad: Promise<void> = Promise.resolve();
  private accountLoadSeq = 0;
  private accountLoading = false;
  private flow: FlowState = IDLE_FLOW;
  private flowGen = 0;
  private loginEpoch = 0;
  private reauthorizeLoginId: string | undefined;
  private settlingGen: number | undefined;
  private repoSeq = 0;
  private repoSyncing = false;
  private signInBannerHidden = false;
  readonly onDidChange = this.emitter.event;
  private readonly requestEmitter = new vscode.EventEmitter<void>();
  readonly onDidRequestAuth = this.requestEmitter.event;

  constructor(private readonly deps: AuthServiceDeps) {
    this.rpc = new AuthRpc(deps.transport);
  }

  get current(): AuthSnapshot {
    return this.snapshot;
  }

  async start(): Promise<void> {
    this.disposables.push(
      this.deps.transport.onDidServerStart((event) => {
        if (event.restart || !this.startHandled) void this.handleServerStart(event.metadata);
      }),
      this.deps.transport.onDidAuthStatusChange((status) => this.applyStatus(status)),
      this.deps.settings.onDidChange(() => void this.refresh())
    );
    const metadata = await this.deps.transport.start();
    if (!this.startHandled) await this.handleServerStart(metadata);
  }

  async signIn(): Promise<void> {
    if (!this.enabled) return;
    this.syncOnSignIn = true;
    this.loginEpoch++;
    this.startFlow({ ...IDLE_FLOW, kind: 'sign-in' });
    this.requestEmitter.fire();
    const epoch = this.loginEpoch;
    this.deps.logUsage('auth/sign-in-started');
    try {
      const login = await this.rpc.login();
      if (epoch !== this.loginEpoch) return await this.abandonLogin(login['login-id']);
      await this.deps.openExternal(login['authorize-url']);
    } catch (error) {
      this.logEvent(signInFailed(authErrorCode(error)));
    }
  }

  async reauthorize(): Promise<void> {
    if (!this.enabled) return;
    if (!this.snapshot.status?.['reauthorize-needed']) return;
    this.deps.logUsage('auth/reauthorize-started');
    try {
      const login = await this.rpc.reauthorize();
      this.reauthorizeLoginId = login['login-id'];
      await this.deps.openExternal(login['authorize-url']);
    } catch (error) {
      this.logEvent(reauthorizeFailed(authErrorCode(error)));
    }
  }

  async openBrowserAgain(): Promise<void> {
    const url = this.snapshot.status?.login?.['authorize-url'];
    if (url) await this.deps.openExternal(url);
  }

  async cancelSignIn(): Promise<void> {
    if (!this.enabled) return;
    const loginId = this.snapshot.status?.login?.['login-id'] ?? this.reauthorizeLoginId;
    if (loginId) {
      this.applyStatus(await this.rpc.cancelLogin(loginId));
      this.reauthorizeLoginId = undefined;
    }
  }

  openAuth(screen?: 'account' | 'project'): void {
    if (!this.enabled) return;
    if (this.flow.kind === 'sign-in') this.publish({ ...this.snapshot, surface: 'auth' });
    else this.startFlow({ ...IDLE_FLOW, kind: flowKindFor(screen) });
    this.requestEmitter.fire();
  }

  async closeAuth(): Promise<void> {
    this.loginEpoch++;
    this.endFlow();
    await this.cancelSignIn();
  }

  skipProject(): void {
    if (this.flow.kind !== 'sign-in') return;
    this.flow = { ...this.flow, projectSkipped: true };
    this.publish(this.snapshot);
  }

  hideSignInBanner(): void {
    if (!this.enabled) return;
    this.signInBannerHidden = true;
    this.publish(this.snapshot);
  }

  async signOut(): Promise<void> {
    if (!this.enabled) return;
    this.deps.logUsage('auth/sign-out');
    this.applyStatus(await this.rpc.logout());
  }

  async retry(): Promise<void> {
    if (!this.enabled) return;
    this.applyStatus(await this.rpc.status(), true);
  }

  async selectAccount(accountId: string): Promise<void> {
    if (!this.enabled) return;
    const gen = this.flowGen;
    const epoch = this.loginEpoch;
    const status = await this.rpc.selectAccount(accountId);
    if (gen === this.flowGen) this.chooseAccount();
    this.applyStatus(status);
    const login = status.login;
    if (!login) return;
    if (epoch !== this.loginEpoch) return this.abandonLogin(login['login-id']);
    this.deps.logUsage('auth/sign-in-started');
    await this.deps.openExternal(login['authorize-url']);
  }

  private async abandonLogin(loginId: string): Promise<void> {
    this.applyStatus(await this.rpc.cancelLogin(loginId));
  }

  async linkProject(projectId: string | null): Promise<void> {
    const repo = this.snapshot.repo;
    if (!this.enabled || !repo) return;
    const gen = this.flowGen;
    const set = await this.rpc.setProjectLink(repo.path, projectId);
    const link = projectId === null ? await fetchProjectLink(this.rpc, repo) : { ...set, source: 'link' as const };
    if (this.isCurrentRepo(repo)) this.publish({ ...this.snapshot, ...linkFields(link) });
    if (gen === this.flowGen && this.flow.kind === 'manual-project') this.endFlow();
  }

  async setAccessToken(token: string): Promise<void> {
    if (this.enabled && token.trim()) {
      this.syncOnSignIn = true;
      this.startFlow({ ...IDLE_FLOW, kind: 'sign-in' });
    }
    await this.deps.settings.setAccessToken(token);
    this.deps.logUsage('auth/pat-set');
  }

  async removeAccessToken(): Promise<void> {
    await this.deps.settings.setAccessToken(undefined);
    this.deps.logUsage('auth/pat-removed');
  }

  async setRepo(repo: AuthRepo | null): Promise<void> {
    if (isDeepStrictEqual(repo, this.snapshot.repo)) return;
    const seq = ++this.repoSeq;
    this.repoSyncing = this.loadedKey !== undefined;
    this.publish({ ...this.snapshot, repo, ...NO_LINK });
    if (!this.loadedKey) return;
    try {
      await this.lookUpRepo(repo);
    } finally {
      if (seq === this.repoSeq) this.stopRepoSyncing();
    }
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.emitter.dispose();
    this.requestEmitter.dispose();
  }

  private async lookUpRepo(repo: AuthRepo | null): Promise<void> {
    if (await this.syncAccount()) return this.accountDataSettled();
    const link = await fetchProjectLink(this.rpc, repo);
    if (this.isCurrentRepo(repo)) this.publish({ ...this.snapshot, ...linkFields(link) });
  }

  private isCurrentRepo(repo: AuthRepo | null): boolean {
    return isDeepStrictEqual(repo, this.snapshot.repo);
  }

  private stopRepoSyncing(): void {
    this.repoSyncing = false;
    this.publish(this.snapshot);
  }

  private async handleServerStart(metadata: ServerMetadata): Promise<void> {
    this.startHandled = true;
    this.syncSupported = true;
    this.capable = metadata.capabilities?.includes(AUTH_CAPABILITY) === true;
    this.optedIn = false;
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.enabled = this.capable && this.deps.settings.read().signInEnabled;
    if (this.enabled) {
      await this.configure();
      return;
    }
    this.forgetAccountData();
    this.repoSyncing = false;
    this.loginEpoch++;
    this.resetFlow();
    this.publish({ ...INACTIVE_SNAPSHOT, repo: this.snapshot.repo });
    await this.optOut();
  }

  private async optOut(): Promise<void> {
    if (!this.optedIn) return;
    this.optedIn = false;
    logOutputChannel.info('[auth] browser sign-in turned off; restarting cs-ide');
    try {
      await this.deps.transport.restart();
    } catch {
      logOutputChannel.warn('[auth] cs-ide restart after turning off sign-in failed');
    }
  }

  private async configure(): Promise<void> {
    const seq = ++this.configureSeq;
    this.optedIn = true;
    this.syncOnSignIn = true;
    try {
      const status = await this.rpc.configure(authConfiguration(this.deps.settings.read()));
      if (seq === this.configureSeq) this.applyStatus(status);
    } catch {
      logOutputChannel.warn('[auth] auth-configure failed; keeping the last status');
    }
  }

  private applyStatus(status: AuthStatus, reloadAccountData = false): void {
    if (!this.enabled) return;
    this.logEvent(signInOutcome(this.snapshot.status, status));
    const startAccountLoad = this.prepareAccountLoad(status, reloadAccountData);
    if (this.reauthorizeLoginId && !status['reauthorize-needed']) {
      this.reauthorizeLoginId = undefined;
    }
    this.publish({ ...this.snapshot, active: true, status });
    startAccountLoad();
    const signedIn = accountDataKey(status) !== undefined;
    const sync = this.takeSignInSync(signedIn);
    if (sync || this.awaitsResolution(signedIn)) void this.settle(sync);
  }

  private takeSignInSync(signedIn: boolean): boolean {
    const sync = this.syncOnSignIn && signedIn;
    if (sync) this.syncOnSignIn = false;
    return sync;
  }

  private awaitsResolution(signedIn: boolean): boolean {
    const unresolved = this.flow.kind === 'sign-in' && !this.flow.resolved;
    return signedIn && unresolved && this.settlingGen !== this.flowGen;
  }

  private async settle(sync: boolean): Promise<void> {
    const gen = this.flowGen;
    this.settlingGen = gen;
    if (sync) await this.syncAccount();
    await this.accountDataSettled();
    if (gen !== this.flowGen) return;
    this.settlingGen = undefined;
    if (this.flow.kind !== 'sign-in') return;
    this.flow = { ...this.flow, resolved: true };
    this.publish(this.snapshot);
  }

  private async accountDataSettled(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this.accountLoad;
      await pending;
    } while (pending !== this.accountLoad);
  }

  private chooseAccount(): void {
    if (this.flow.kind === 'idle') return;
    const resolved = this.flow.kind === 'sign-in' ? false : this.flow.resolved;
    this.flow = { ...this.flow, accountChosen: true, resolved };
  }

  private startFlow(flow: FlowState): void {
    this.flowGen++;
    this.flow = flow;
    this.publish({ ...this.snapshot, surface: 'auth' });
  }

  private endFlow(): void {
    this.resetFlow();
    this.publish({ ...this.snapshot, surface: 'monitor' });
  }

  private resetFlow(): void {
    this.flowGen++;
    this.flow = IDLE_FLOW;
  }

  private syncableRepo(): AuthRepo | null {
    return this.enabled && this.syncSupported ? this.snapshot.repo : null;
  }

  /** Moves cs-ide to the account that owns the current repository. True when the account changed. */
  private async syncAccount(): Promise<boolean> {
    const repo = this.syncableRepo();
    if (!repo) return false;
    try {
      const status = await this.rpc.syncAccount(repo.path);
      const switched = accountDataKey(status) !== accountDataKey(this.snapshot.status);
      this.applyStatus(status);
      return switched;
    } catch (error) {
      if (isMethodNotFound(error)) this.syncSupported = false;
      else logOutputChannel.warn(`[auth] account sync failed code=${authErrorCode(error) ?? 'unknown'}`);
      return false;
    }
  }

  private prepareAccountLoad(status: AuthStatus, reload: boolean): () => void {
    const key = accountDataKey(status);
    if (!reload && key === this.loadedKey) return () => undefined;
    this.loadedKey = key;
    this.accountLoading = key !== undefined;
    const seq = ++this.accountLoadSeq;
    return () => {
      this.accountLoad = this.fetchAccountDataFor(key, seq);
    };
  }

  private async fetchAccountDataFor(key: string | undefined, seq: number): Promise<void> {
    const repo = this.snapshot.repo;
    const data = key ? await fetchAccountData(this.rpc, repo) : EMPTY_ACCOUNT_DATA;
    if (seq !== this.accountLoadSeq) return;
    this.accountLoading = false;
    this.publish({ ...this.snapshot, ...this.forCurrentRepo(data, repo) });
  }

  private forgetAccountData(): void {
    this.loadedKey = undefined;
    this.accountLoadSeq++;
    this.accountLoading = false;
  }

  private forCurrentRepo(data: AccountData, repo: AuthRepo | null): Partial<AccountData> {
    if (this.isCurrentRepo(repo)) return data;
    return { accounts: data.accounts, projects: data.projects };
  }

  private logEvent(event: AuthTelemetryEvent | undefined): void {
    if (event) this.deps.logUsage(event.name, event.data);
  }

  private present(next: AuthSnapshot): AuthSnapshot {
    const step = nextStep(this.stepFlow(), next);
    if (step === 'done') this.resetFlow();
    return {
      ...next,
      surface: step === 'done' ? 'monitor' : next.surface,
      step: step === 'done' ? 'summary' : step,
      context: this.flow.kind === 'sign-in' ? 'sign-in' : 'manual',
      syncing: this.isSyncing(),
      signInBannerHidden: this.signInBannerHidden,
    };
  }

  private stepFlow(): FlowState {
    const lookingUpRepo = this.repoSyncing && this.flow.kind === 'sign-in';
    return lookingUpRepo ? { ...this.flow, resolved: false } : this.flow;
  }

  private isSyncing(): boolean {
    const resolvingSignIn = this.flow.kind === 'sign-in' && !this.flow.resolved;
    return this.repoSyncing || this.accountLoading || resolvingSignIn;
  }

  private publish(next: AuthSnapshot): void {
    const presented = this.present(next);
    if (isDeepStrictEqual(presented, this.snapshot)) return;
    this.snapshot = presented;
    this.emitter.fire(presented);
  }
}
