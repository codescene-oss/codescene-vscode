import vscode from 'vscode';
import { isDeepStrictEqual } from 'util';
import type { AuthStatus } from '../centralized-webview-framework/types/auth';
import type { ServerMetadata } from '../devtools-api/ide-server-client';
import { logOutputChannel } from '../log';
import { INACTIVE_SNAPSHOT, type AuthSnapshot } from './auth-payload';
import { AuthRpc } from './auth-rpc';
import { authConfiguration, type AuthSettings } from './auth-settings';
import { signInOutcome, type AuthTelemetryEvent } from './auth-telemetry';
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

  async retry(): Promise<void> {
    this.applyStatus(await this.rpc.status());
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

  private applyStatus(status: AuthStatus): void {
    if (!this.enabled) return;
    this.logEvent(signInOutcome(this.snapshot.status, status));
    this.publish({ ...this.snapshot, active: true, status });
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
