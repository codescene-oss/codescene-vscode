import vscode from 'vscode';
import { isDeepStrictEqual } from 'util';
import type { AuthStatus } from '../centralized-webview-framework/types/auth';
import type { ServerMetadata } from '../devtools-api/ide-server-client';
import { logOutputChannel } from '../log';
import { EMPTY_ACCOUNT_DATA, fetchAccountData, fetchLinkedProject } from './account-data';
import { accountDataKey, INACTIVE_SNAPSHOT, type AuthRepo, type AuthSnapshot } from './auth-payload';
import { authErrorCode, AuthRpc } from './auth-rpc';
import { authConfiguration, type AuthSettings } from './auth-settings';
import { signInFailed, signInOutcome, type AuthTelemetryEvent } from './auth-telemetry';
import type { AuthTransport } from './auth-transport';

export const AUTH_CAPABILITY = 'auth-v1';

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
  private configureSeq = 0;
  private loadedKey: string | undefined;
  readonly onDidChange = this.emitter.event;

  constructor(private readonly deps: AuthServiceDeps) {
    this.rpc = new AuthRpc(deps.transport);
  }

  get current(): AuthSnapshot {
    return this.snapshot;
  }

  async start(): Promise<void> {
    this.disposables.push(
      this.deps.transport.onDidServerStart((event) => {
        if (event.restart) void this.handleServerStart(event.metadata);
      }),
      this.deps.transport.onDidAuthStatusChange((status) => this.applyStatus(status)),
      this.deps.settings.onDidChange(() => void this.refresh())
    );
    await this.handleServerStart(await this.deps.transport.start());
  }

  async signIn(): Promise<void> {
    if (!this.enabled) return;
    this.deps.logUsage('auth/sign-in-started');
    try {
      const login = await this.rpc.login();
      await this.deps.openExternal(login['authorize-url']);
    } catch (error) {
      this.logEvent(signInFailed(authErrorCode(error)));
    }
  }

  async openBrowserAgain(): Promise<void> {
    const url = this.snapshot.status?.login?.['authorize-url'];
    if (url) await this.deps.openExternal(url);
  }

  async cancelSignIn(): Promise<void> {
    if (!this.enabled) return;
    const loginId = this.snapshot.status?.login?.['login-id'];
    if (loginId) this.applyStatus(await this.rpc.cancelLogin(loginId));
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
    const status = await this.rpc.selectAccount(accountId);
    this.applyStatus(status);
    const url = status.login?.['authorize-url'];
    if (!url) return;
    this.deps.logUsage('auth/sign-in-started');
    await this.deps.openExternal(url);
  }

  async linkProject(projectId: string | null): Promise<void> {
    const repo = this.snapshot.repo;
    if (!this.enabled || !repo) return;
    const link = await this.rpc.setProjectLink(repo.path, projectId);
    this.publish({ ...this.snapshot, linkedProject: link.project });
  }

  async setAccessToken(token: string): Promise<void> {
    await this.deps.settings.setAccessToken(token);
    this.deps.logUsage('auth/pat-set');
  }

  async removeAccessToken(): Promise<void> {
    await this.deps.settings.setAccessToken(undefined);
    this.deps.logUsage('auth/pat-removed');
  }

  async setRepo(repo: AuthRepo | null): Promise<void> {
    if (isDeepStrictEqual(repo, this.snapshot.repo)) return;
    this.publish({ ...this.snapshot, repo, linkedProject: null });
    if (!this.loadedKey) return;
    const linkedProject = await fetchLinkedProject(this.rpc, repo);
    if (isDeepStrictEqual(repo, this.snapshot.repo)) this.publish({ ...this.snapshot, linkedProject });
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.emitter.dispose();
  }

  private async handleServerStart(metadata: ServerMetadata): Promise<void> {
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
    this.loadedKey = undefined;
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
    this.publish({ ...this.snapshot, active: true, status });
    void this.loadAccountData(status, reloadAccountData);
  }

  private async loadAccountData(status: AuthStatus, reload: boolean): Promise<void> {
    const key = accountDataKey(status);
    if (!reload && key === this.loadedKey) return;
    this.loadedKey = key;
    const data = key ? await fetchAccountData(this.rpc, this.snapshot.repo) : EMPTY_ACCOUNT_DATA;
    if (key === this.loadedKey) this.publish({ ...this.snapshot, ...data });
  }

  private logEvent(event: AuthTelemetryEvent | undefined): void {
    if (event) this.deps.logUsage(event.name, event.data);
  }

  private publish(next: AuthSnapshot): void {
    if (isDeepStrictEqual(next, this.snapshot)) return;
    this.snapshot = next;
    this.emitter.fire(next);
  }
}
