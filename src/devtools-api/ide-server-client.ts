import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import vscode from 'vscode';
import { CancellationToken, CancellationTokenSource, createMessageConnection, MessageConnection } from 'vscode-jsonrpc/node';
import { logOutputChannel } from '../log';
import { Delta } from './delta-model';
import { CheckRulesResponse, CodeHealthRulesTemplateResponse } from './model';
import { FnToRefactor, PreFlightResponse, RefactorResponse } from './refactor-models';
import { Review } from './review-model';
import { TelemetryEvent, TelemetryResponse } from './telemetry-model';
import {
  checkRulesResponse,
  deltaResponse,
  deviceIdResponse,
  fnToRefactorResponse,
  notificationRepoRoot,
  preflightResponse,
  refactorResponse,
  reviewResponse,
} from './rpc-response-normalizers';

const STARTUP_TIMEOUT_MS = 30000;

export interface ServerMetadata {
  sha: string;
  version: string;
}

export interface ReviewFile {
  id: string;
  relPath: string;
  content: string;
}

export interface ReviewResult {
  id: string;
  path: string;
  repoRoot: string;
  result: Review;
}

export interface DeltaResult {
  id: string;
  path: string;
  repoRoot: string;
  result: Delta | null;
}

export interface ReviewFailed {
  id: string;
  path: string;
  repoRoot: string;
  message: string;
}

export interface ReviewParams {
  path: string;
  'file-content'?: string;
  'cache-path'?: string;
}

export interface DeltaParams {
  'old-score'?: string;
  'new-score'?: string;
}

export interface FnsToRefactorParams {
  'file-name': string;
  'file-content': string;
  preflight: PreFlightResponse;
  'cache-path'?: string;
  'delta-result'?: Delta;
  'code-smells'?: unknown[];
}

export interface RefactorParams {
  token: string;
  'fn-to-refactor'?: FnToRefactor;
  'fn-to-refactor-nippy-b64'?: string;
  'skip-cache'?: boolean;
}

interface ResultNotification<T> {
  id?: string;
  path: string;
  repoRoot?: string;
  'repo-root'?: string;
  result: T;
}

interface NotificationIdentity {
  id: string;
  path: string;
  repoRoot: string;
}

export class CsIdeServerClient implements vscode.Disposable {
  private process?: ChildProcess;
  private connection?: MessageConnection;
  private startPromise?: Promise<ServerMetadata>;
  private resolveStart?: (metadata: ServerMetadata) => void;
  private rejectStart?: (error: Error) => void;
  private startupTimeout?: ReturnType<typeof setTimeout>;
  private readonly reviewEmitter = new vscode.EventEmitter<ReviewResult>();
  private readonly deltaEmitter = new vscode.EventEmitter<DeltaResult>();
  private readonly reviewFailedEmitter = new vscode.EventEmitter<ReviewFailed>();
  private readonly errorEmitter = new vscode.EventEmitter<Error>();

  readonly onDidReview = this.reviewEmitter.event;
  readonly onDidDelta = this.deltaEmitter.event;
  readonly onDidReviewFailed = this.reviewFailedEmitter.event;
  readonly onDidError = this.errorEmitter.event;

  constructor(
    readonly binaryPath: string,
    private readonly args?: string[],
    private readonly serverArgs: string[] = ['server']
  ) {}

  static fromDistribution(binaryPath: string, serverArgs: string[] = ['server']): CsIdeServerClient {
    return new CsIdeServerClient(binaryPath, undefined, serverArgs);
  }

  private get command(): { path: string; args: string[] } {
    if (this.args) return { path: this.binaryPath, args: this.args };
    const java = path.join(this.binaryPath, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const jar = path.join(this.binaryPath, 'cs-ide.jar');
    return { path: java, args: ['--enable-native-access=ALL-UNNAMED', '-jar', jar, ...this.serverArgs] };
  }

  start(): Promise<ServerMetadata> {
    if (this.startPromise) return this.startPromise;

    const startPromise = new Promise<ServerMetadata>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    this.startPromise = startPromise;
    this.startupTimeout = setTimeout(() => {
      this.handleProcessFailure(new Error(`cs-ide server did not send cs-ide/start within ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);

    try {
      const command = this.command;
      const process = spawn(command.path, command.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.process = process;
      process.on('error', (error) => this.handleProcessFailure(error, process));
      process.stderr?.on('data', (data) => logOutputChannel.debug(`[cs-ide] ${data.toString().trim()}`));
      process.on('exit', (code, signal) => {
        this.handleProcessFailure(new Error(`cs-ide server exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`), process);
      });

      const connection = createMessageConnection(process.stdout!, process.stdin!);
      this.connection = connection;
      connection.onNotification('cs-ide/start', (metadata: ServerMetadata) => this.handleStart(metadata));
      connection.onNotification('cs-ide/fileReview', (notification: ResultNotification<Record<string, any>>) =>
        this.handleReview(notification));
      connection.onNotification('cs-ide/deltaReview', (notification: ResultNotification<Record<string, any> | null>) =>
        this.handleDelta(notification));
      connection.onNotification('cs-ide/reviewFailed', (notification: Omit<ReviewFailed, 'repoRoot'> & { repoRoot?: string; 'repo-root'?: string }) =>
        this.handleReviewFailure(notification));
      connection.onError(([error]) => this.handleError(error));
      connection.listen();
    } catch (error) {
      this.handleProcessFailure(error instanceof Error ? error : new Error(String(error)));
    }
    return startPromise;
  }

  restart(): Promise<ServerMetadata> {
    this.stopProcess(new Error('CodeScene IDE server restarted'));
    return this.start();
  }

  async review(params: ReviewParams): Promise<Review> {
    return reviewResponse(await this.sendRequest('cs-ide/review', params));
  }

  async delta(params: DeltaParams): Promise<Delta | null> {
    const response = await this.sendRequest<Record<string, any> | null>('cs-ide/delta', params);
    return response ? deltaResponse(response) : null;
  }

  async preflight(params: { force?: boolean } = {}): Promise<PreFlightResponse> {
    return preflightResponse(await this.sendRequest('cs-ide/preflight', params));
  }

  async fnsToRefactor(params: FnsToRefactorParams): Promise<FnToRefactor[]> {
    const response = await this.sendRequest<Record<string, any>[]>('cs-ide/fns-to-refactor', params);
    return response.map(fnToRefactorResponse);
  }

  async refactor(params: RefactorParams, signal?: AbortSignal): Promise<RefactorResponse> {
    const cancellation = new CancellationTokenSource();
    const cancel = () => cancellation.cancel();
    signal?.addEventListener('abort', cancel);
    if (signal?.aborted) cancel();
    try {
      return refactorResponse(await this.sendRequest('cs-ide/refactor', params, cancellation.token));
    } finally {
      signal?.removeEventListener('abort', cancel);
      cancellation.dispose();
    }
  }

  async telemetry(event: TelemetryEvent): Promise<TelemetryResponse> {
    return this.sendRequest('cs-ide/telemetry', { event });
  }

  async deviceId(): Promise<{ 'device-id': string }> {
    return deviceIdResponse(await this.sendRequest('cs-ide/device-id', {}));
  }

  async codeHealthRulesTemplate(): Promise<CodeHealthRulesTemplateResponse> {
    return this.sendRequest('cs-ide/code-health-rules-template', {});
  }

  async checkRules(repoRoot: string, path: string): Promise<CheckRulesResponse> {
    return checkRulesResponse(await this.sendRequest('cs-ide/check-rules', { 'repo-root': repoRoot, path }));
  }

  reviewFiles(repoRoot: string, files: ReviewFile[], baselineRevision?: string): void {
    void this.sendReviewFiles(repoRoot, files, baselineRevision).catch((error) => {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  dispose(): void {
    this.stopProcess(new Error('CodeScene IDE server stopped'));
    this.reviewEmitter.dispose();
    this.deltaEmitter.dispose();
    this.reviewFailedEmitter.dispose();
    this.errorEmitter.dispose();
  }

  private async sendRequest<T>(method: string, params: unknown, token?: CancellationToken): Promise<T> {
    await this.start();
    if (!this.connection) throw new Error('CodeScene IDE server is not running');
    return token === undefined
      ? this.connection.sendRequest<T>(method, params)
      : this.connection.sendRequest<T>(method, params, token);
  }

  private async sendReviewFiles(repoRoot: string, files: ReviewFile[], baselineRevision?: string): Promise<void> {
    await this.start();
    if (!this.connection) throw new Error('CodeScene IDE server is not running');
    logOutputChannel.info(`[cs-ide] sending reviewFiles count=${files.length}`);
    await this.connection.sendNotification('cs-ide/reviewFiles', {
      'repo-root': repoRoot,
      ...(baselineRevision ? { 'baseline-revision': baselineRevision } : {}),
      files: files.map((file) => ({ id: file.id, 'rel-path': file.relPath, content: file.content })),
    });
  }

  private handleStart(metadata: ServerMetadata): void {
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
    this.startupTimeout = undefined;
    this.resolveStart?.(metadata);
    this.resolveStart = undefined;
    this.rejectStart = undefined;
  }

  private handleReview(notification: ResultNotification<Record<string, any>>): void {
    const identity = this.notificationIdentity(notification);
    if (!identity) return;
    logOutputChannel.info(`[cs-ide] received fileReview id=${identity.id} path=${identity.path}`);
    this.reviewEmitter.fire({
      ...identity,
      result: reviewResponse(notification.result),
    });
  }

  private handleDelta(notification: ResultNotification<Record<string, any> | null>): void {
    const identity = this.notificationIdentity(notification);
    if (!identity) return;
    logOutputChannel.info(`[cs-ide] received deltaReview id=${identity.id} path=${identity.path}`);
    this.deltaEmitter.fire({
      ...identity,
      result: notification.result ? deltaResponse(notification.result) : null,
    });
  }

  private handleReviewFailure(
    notification: Omit<ReviewFailed, 'repoRoot'> & { repoRoot?: string; 'repo-root'?: string }
  ): void {
    const identity = this.notificationIdentity(notification);
    if (!identity) return;
    this.reviewFailedEmitter.fire({
      ...identity,
      message: notification.message,
    });
  }

  private notificationIdentity(notification: { id?: string; path?: string; repoRoot?: string; 'repo-root'?: string }): NotificationIdentity | undefined {
    const repoRoot = notificationRepoRoot(notification);
    if (!notification.id) return;
    if (!notification.path) return;
    if (!repoRoot) return;
    return { id: notification.id, path: notification.path, repoRoot };
  }

  private handleProcessFailure(error: Error, process?: ChildProcess): void {
    if (process && process !== this.process) return;
    if (this.hasNoProcessState()) return;
    const failedProcess = this.process;
    this.clearProcessState(error);
    this.killProcess(failedProcess);
    this.handleError(error);
  }

  private stopProcess(error: Error): void {
    const process = this.process;
    this.clearProcessState(error);
    this.killProcess(process);
  }

  private killProcess(process: ChildProcess | undefined): void {
    if (!process || process.exitCode !== null) return;
    if (global.process.platform === 'win32' && process.pid) {
      try {
        const taskkill = spawn('taskkill', ['/pid', String(process.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        taskkill.on('error', () => process.kill());
      } catch {
        process.kill();
      }
      return;
    }
    process.kill('SIGTERM');
  }

  private hasNoProcessState(): boolean {
    return !this.process && !this.connection && !this.startPromise;
  }

  private clearProcessState(error?: Error): void {
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
    this.startupTimeout = undefined;
    if (error) this.rejectStart?.(error);
    this.connection?.dispose();
    this.connection = undefined;
    this.process = undefined;
    this.resolveStart = undefined;
    this.rejectStart = undefined;
    this.startPromise = undefined;
  }

  private handleError(error: Error): void {
    logOutputChannel.error(`cs-ide server error: ${error.message}`);
    this.errorEmitter.fire(error);
  }
}
