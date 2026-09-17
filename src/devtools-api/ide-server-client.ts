import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import vscode from 'vscode';
import { CancellationToken, CancellationTokenSource, createMessageConnection, MessageConnection } from 'vscode-jsonrpc/node';
import { formatLogFields, logOutputChannel } from '../log';
import { relativePosix, toPosixRelPath } from '../utils/fs-paths';
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
  queueResponse,
  reviewResponse,
  watchInventoryResponse,
} from './rpc-response-normalizers';

const STARTUP_TIMEOUT_MS = 30000;

export function distributionServerCommand(
  distributionPath: string,
  serverArgs: string[] = ['server']
): { path: string; args: string[] } {
  const exe = path.join(distributionPath, process.platform === 'win32' ? 'cs-ide.exe' : 'cs-ide');
  return { path: exe, args: serverArgs };
}

export interface ServerMetadata {
  sha: string;
  version: string;
}

export interface ServerStartEvent {
  metadata: ServerMetadata;
  restart: boolean;
}

/**
 * The set of files the CLI considers changed against the baseline for a repo. The CLI never
 * reports individual removals, so this is the only signal that a file left the change set.
 */
export interface WatchInventory {
  repoRoot: string;
  files: string[];
}

export interface ReviewFile {
  id?: string;
  relPath: string;
  content?: string;
}

export interface ReviewResult {
  id?: string;
  path: string;
  repoRoot: string;
  result: Review;
}

export interface DeltaResult {
  id?: string;
  path: string;
  repoRoot: string;
  result: Delta | null;
}

export interface ReviewFailed {
  id?: string;
  path: string;
  repoRoot: string;
  message: string;
}

export interface ReviewQueue {
  count: number;
  files: string[];
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
  queue?: unknown;
}

interface NotificationIdentity {
  id?: string;
  path: string;
  repoRoot: string;
}

function relativePathsParam(relativePaths?: string[]): { 'relative-paths'?: string[] } {
  return relativePaths ? { 'relative-paths': relativePaths } : {};
}

export class CsIdeServerClient implements vscode.Disposable {
  private process?: ChildProcess;
  private connection?: MessageConnection;
  private startPromise?: Promise<ServerMetadata>;
  private resolveStart?: (metadata: ServerMetadata) => void;
  private rejectStart?: (error: Error) => void;
  private startupTimeout?: ReturnType<typeof setTimeout>;
  private startCount = 0;
  private requestSeq = 0;
  private readonly reviewEmitter = new vscode.EventEmitter<ReviewResult>();
  private readonly deltaEmitter = new vscode.EventEmitter<DeltaResult>();
  private readonly reviewFailedEmitter = new vscode.EventEmitter<ReviewFailed>();
  private readonly errorEmitter = new vscode.EventEmitter<Error>();
  private readonly watchInventoryEmitter = new vscode.EventEmitter<WatchInventory>();
  private readonly serverStartEmitter = new vscode.EventEmitter<ServerStartEvent>();
  private readonly queueEmitter = new vscode.EventEmitter<ReviewQueue>();

  readonly onDidReview = this.reviewEmitter.event;
  readonly onDidDelta = this.deltaEmitter.event;
  readonly onDidReviewFailed = this.reviewFailedEmitter.event;
  readonly onDidError = this.errorEmitter.event;
  readonly onDidWatchInventory = this.watchInventoryEmitter.event;
  readonly onDidServerStart = this.serverStartEmitter.event;
  readonly onDidQueue = this.queueEmitter.event;

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
    return distributionServerCommand(this.binaryPath, this.serverArgs);
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
      logOutputChannel.info(`[cs-ide] starting ${formatLogFields({ path: command.path, args: command.args.join(' ') })}`);
      const process = spawn(command.path, command.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.process = process;
      logOutputChannel.info(`[cs-ide] started ${formatLogFields({ pid: process.pid, path: command.path })}`);
      let stderr = '';
      process.on('error', (error) => this.handleProcessFailure(error, process));
      process.stderr?.on('data', (data) => {
        const text = data.toString();
        if (stderr.length < 4000) stderr += text.slice(0, 4000 - stderr.length);
        const trimmed = text.trim();
        if (trimmed) logOutputChannel.debug(`[cs-ide] ${trimmed}`);
      });
      process.on('exit', (code, signal) => {
        const detail = stderr.trim();
        this.handleProcessFailure(
          new Error(
            `cs-ide server exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}${detail ? `: ${detail}` : ''}`
          ),
          process
        );
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
      connection.onNotification('cs-ide/watchInventoryChanged', (notification: Record<string, any>) =>
        this.handleWatchInventory(notification));
      connection.onError(([error]) => this.handleError(error));
      connection.listen();
    } catch (error) {
      this.handleProcessFailure(error instanceof Error ? error : new Error(String(error)));
    }
    return startPromise;
  }

  restart(): Promise<ServerMetadata> {
    logOutputChannel.info('[cs-ide] restarting');
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

  async checkRules(repoRoot: string, filePath: string): Promise<CheckRulesResponse> {
    const relativePath = path.isAbsolute(filePath) ? relativePosix(repoRoot, filePath) : toPosixRelPath(filePath);
    return checkRulesResponse(await this.sendRequest('cs-ide/check-rules', { 'repo-root': repoRoot, path: relativePath }));
  }

  async getWatchInventory(repoRoot: string): Promise<WatchInventory> {
    const response = await this.sendRequest<Record<string, any>>('cs-ide/getWatchInventory', { 'repo-root': repoRoot });
    const inventory = watchInventoryResponse(response);
    return { repoRoot: inventory.repoRoot ?? repoRoot, files: inventory.files };
  }

  reviewFiles(repoRoot: string, files: ReviewFile[]): void {
    void this.sendReviewFiles(repoRoot, files).catch((error) => {
      this.handleError(error instanceof Error ? error : new Error(String(error)), true);
    });
  }

  watchFiles(repoRoot: string, relativePaths?: string[]): void {
    const params = { 'repo-root': repoRoot, ...relativePathsParam(relativePaths) };
    logOutputChannel.info(
      `[cs-ide] sending watchFiles ${formatLogFields({
        repo: repoRoot,
        relativePaths: relativePaths ?? '(whole repository)',
      })}`
    );
    void this.sendNotification('cs-ide/watchFiles', params).catch((error) => {
      this.handleError(error instanceof Error ? error : new Error(String(error)), true);
    });
  }

  stopWatchFiles(repoRoot: string, relativePaths?: string[]): void {
    if (!this.connection) {
      logOutputChannel.info(`[cs-ide] skip stopWatchFiles ${formatLogFields({ repo: repoRoot, reason: 'not-running' })}`);
      return;
    }
    logOutputChannel.info(
      `[cs-ide] sending stopWatchFiles ${formatLogFields({
        repo: repoRoot,
        relativePaths: relativePaths ?? '(whole repository)',
      })}`
    );
    void this.connection
      .sendNotification('cs-ide/stopWatchFiles', {
        'repo-root': repoRoot,
        ...relativePathsParam(relativePaths),
      })
      .catch((error) => {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      });
  }

  dispose(): void {
    this.stopProcess(new Error('CodeScene IDE server stopped'));
    this.reviewEmitter.dispose();
    this.deltaEmitter.dispose();
    this.reviewFailedEmitter.dispose();
    this.errorEmitter.dispose();
    this.watchInventoryEmitter.dispose();
    this.serverStartEmitter.dispose();
    this.queueEmitter.dispose();
  }

  private async sendRequest<T>(method: string, params: unknown, token?: CancellationToken): Promise<T> {
    await this.start();
    if (!this.connection) throw new Error('CodeScene IDE server is not running');
    const id = ++this.requestSeq;
    const started = Date.now();
    const requestSummary = summarizeRequest(method, params);
    logOutputChannel.info(
      `[cs-ide] sending id=${id} method=${method}${requestSummary ? ` ${requestSummary}` : ''}`
    );
    try {
      const result = token === undefined
        ? await this.connection.sendRequest<T>(method, params)
        : await this.connection.sendRequest<T>(method, params, token);
      const responseSummary = summarizeResponse(method, result);
      logOutputChannel.info(
        `[cs-ide] received id=${id} method=${method} durationMs=${Date.now() - started}${responseSummary ? ` ${responseSummary}` : ''}`
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logOutputChannel.error(
        `[cs-ide] request failed id=${id} method=${method} durationMs=${Date.now() - started}: ${message}`
      );
      throw error;
    }
  }

  private async sendNotification(method: string, params: unknown): Promise<void> {
    await this.start();
    if (!this.connection) throw new Error('CodeScene IDE server is not running');
    try {
      await this.connection.sendNotification(method, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logOutputChannel.error(`[cs-ide] notification failed method=${method}: ${message}`);
      throw error;
    }
  }

  private async sendReviewFiles(repoRoot: string, files: ReviewFile[]): Promise<void> {
    logOutputChannel.info(
      `[cs-ide] sending reviewFiles ${formatLogFields({
        repo: repoRoot,
        count: files.length,
        files: files.map((file) => file.relPath),
        withContent: files.filter((file) => file.content !== undefined).length,
        withId: files.filter((file) => file.id !== undefined).length,
      })}`
    );
    await this.sendNotification('cs-ide/reviewFiles', {
      'repo-root': repoRoot,
      files: files.map((file) => ({
        'rel-path': file.relPath,
        ...(file.id ? { id: file.id } : {}),
        ...(file.content !== undefined ? { content: file.content } : {}),
      })),
    });
  }

  private handleStart(metadata: ServerMetadata): void {
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
    this.startupTimeout = undefined;
    this.startCount++;
    const restart = this.startCount > 1;
    logOutputChannel.info(
      `[cs-ide] received start ${formatLogFields({ version: metadata.version, sha: metadata.sha, restart })}`
    );
    this.resolveStart?.(metadata);
    this.resolveStart = undefined;
    this.rejectStart = undefined;
    this.serverStartEmitter.fire({ metadata, restart });
  }

  private handleWatchInventory(notification: Record<string, any>): void {
    const { repoRoot, files } = watchInventoryResponse(notification);
    if (!repoRoot) {
      logOutputChannel.info('[cs-ide] ignoring watchInventoryChanged reason=missing-repo');
      return;
    }
    logOutputChannel.info(
      `[cs-ide] received watchInventoryChanged ${formatLogFields({ repo: repoRoot, count: files.length, files })}`
    );
    this.watchInventoryEmitter.fire({ repoRoot, files });
  }

  private handleReview(notification: ResultNotification<Record<string, any>>): void {
    const identity = this.notificationIdentity(notification, 'fileReview');
    if (!identity) return;
    const result = reviewResponse(notification.result);
    logOutputChannel.info(
      `[cs-ide] received fileReview ${formatLogFields({
        id: identity.id ?? '(none)',
        path: identity.path,
        repo: identity.repoRoot,
        ...reviewSummary(result),
      })}`
    );
    this.emitQueue(notification, identity.repoRoot);
    this.reviewEmitter.fire({
      ...identity,
      result,
    });
  }

  private handleDelta(notification: ResultNotification<Record<string, any> | null>): void {
    const identity = this.notificationIdentity(notification, 'deltaReview');
    if (!identity) return;
    const result = notification.result ? deltaResponse(notification.result) : null;
    logOutputChannel.info(
      `[cs-ide] received deltaReview ${formatLogFields({
        id: identity.id ?? '(none)',
        path: identity.path,
        repo: identity.repoRoot,
        ...deltaSummary(result),
      })}`
    );
    this.emitQueue(notification, identity.repoRoot);
    this.deltaEmitter.fire({
      ...identity,
      result,
    });
  }

  private handleReviewFailure(
    notification: Omit<ReviewFailed, 'repoRoot'> & { repoRoot?: string; 'repo-root'?: string; queue?: unknown }
  ): void {
    const identity = this.notificationIdentity(notification, 'reviewFailed');
    if (!identity) return;
    logOutputChannel.info(
      `[cs-ide] received reviewFailed ${formatLogFields({
        id: identity.id ?? '(none)',
        path: identity.path,
        repo: identity.repoRoot,
        message: notification.message,
      })}`
    );
    this.emitQueue(notification, identity.repoRoot);
    this.reviewFailedEmitter.fire({
      ...identity,
      message: notification.message,
    });
  }

  private emitQueue(notification: { queue?: unknown }, repoRoot: string): void {
    const queue = queueResponse(notification);
    if (!queue) return;
    logOutputChannel.info(
      `[cs-ide] received queue ${formatLogFields({ repo: repoRoot, count: queue.count, files: queue.files })}`
    );
    this.queueEmitter.fire({
      count: queue.count,
      files: queue.files.map((relPath) => path.join(repoRoot, ...toPosixRelPath(relPath).split('/'))),
    });
  }

  private notificationIdentity(
    notification: { id?: string; path?: string; repoRoot?: string; 'repo-root'?: string },
    kind: string
  ): NotificationIdentity | undefined {
    const repoRoot = notificationRepoRoot(notification);
    if (!notification.path) {
      logOutputChannel.info(`[cs-ide] ignoring ${kind} reason=missing-path`);
      return;
    }
    if (!repoRoot) {
      logOutputChannel.info(`[cs-ide] ignoring ${kind} ${formatLogFields({ path: notification.path, reason: 'missing-repo' })}`);
      return;
    }
    return { ...(notification.id ? { id: notification.id } : {}), path: notification.path, repoRoot };
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
    logOutputChannel.info(
      `[cs-ide] stopping ${formatLogFields({ pid: this.process?.pid, reason: error.message })}`
    );
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

  private handleError(error: Error, alreadyLogged = false): void {
    if (!alreadyLogged) logOutputChannel.error(`cs-ide server error: ${error.message}`);
    this.errorEmitter.fire(error);
  }
}

function isWireObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function wireField<T>(value: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (value[key] !== undefined) return value[key] as T;
  }
  return undefined;
}

function fnsToRefactorInput(value: Record<string, unknown>): string {
  if (value['delta-result'] !== undefined) return 'delta-result';
  if (Array.isArray(value['code-smells'])) return 'code-smells';
  return 'none';
}

function refactorPayloadFormat(value: Record<string, unknown>): string {
  if (value['fn-to-refactor-nippy-b64'] !== undefined) return 'nippy-b64';
  if (value['fn-to-refactor'] !== undefined) return 'json';
  return 'none';
}

function telemetryEventName(value: Record<string, unknown>): unknown {
  return isWireObject(value.event) ? value.event['event-name'] : undefined;
}

const requestSummaries: Record<string, (value: Record<string, unknown>) => string> = {
  'cs-ide/review': (value) => formatLogFields({
    path: value.path,
    hasContent: value['file-content'] !== undefined,
    hasCachePath: value['cache-path'] !== undefined,
  }),
  'cs-ide/delta': (value) => formatLogFields({
    hasOldScore: value['old-score'] !== undefined,
    hasNewScore: value['new-score'] !== undefined,
  }),
  'cs-ide/preflight': (value) => formatLogFields({ force: value.force === true }),
  'cs-ide/fns-to-refactor': (value) => formatLogFields({
    fileName: value['file-name'],
    input: fnsToRefactorInput(value),
    smellCount: Array.isArray(value['code-smells']) ? value['code-smells'].length : undefined,
    hasCachePath: value['cache-path'] !== undefined,
  }),
  'cs-ide/refactor': (value) => formatLogFields({
    format: refactorPayloadFormat(value),
    skipCache: value['skip-cache'] === true,
  }),
  'cs-ide/telemetry': (value) => formatLogFields({ eventName: telemetryEventName(value) }),
  'cs-ide/check-rules': (value) => formatLogFields({ repoRoot: value['repo-root'], path: value.path }),
  'cs-ide/getWatchInventory': (value) => formatLogFields({ repoRoot: value['repo-root'] }),
};

function summarizeRequest(method: string, params: unknown): string {
  if (!isWireObject(params)) return '';
  return requestSummaries[method]?.(params) ?? '';
}

function summarizeFnsToRefactorResponse(result: unknown[]): string {
  return formatLogFields({
    count: result.length,
    functions: result.map(summarizeFnToRefactor),
  });
}

const responseSummaries: Record<string, (value: Record<string, unknown>) => string> = {
  'cs-ide/review': (value) => formatLogFields(reviewSummary(reviewResponse(value))),
  'cs-ide/delta': (value) => formatLogFields(deltaSummary(deltaResponse(value))),
  'cs-ide/preflight': (value) => {
    const response = preflightResponse(value);
    return formatLogFields({
      version: response.version,
      fileTypes: response['file-types'],
      codeSmellCount: response['language-common']['code-smells'].length,
      maxInputLoc: response['language-common']['max-input-loc'],
    });
  },
  'cs-ide/refactor': (value) => {
    const response = refactorResponse(value);
    return formatLogFields({
      traceId: response['trace-id'],
      confidence: response.confidence.level,
      cached: response.metadata['cached?'] === true,
      reasonCount: response.reasons.length,
      added: response['refactoring-properties']['added-code-smells'],
      removed: response['refactoring-properties']['removed-code-smells'],
    });
  },
  'cs-ide/telemetry': (value) => formatLogFields({ status: value.status }),
  'cs-ide/device-id': () => formatLogFields({ ok: true }),
  'cs-ide/code-health-rules-template': () => formatLogFields({ ok: true }),
  'cs-ide/check-rules': (value) => {
    const response = checkRulesResponse(value);
    return formatLogFields({
      failed: response.failed,
      parsingErrorCount: response['parsing-errors']?.length ?? 0,
    });
  },
  'cs-ide/getWatchInventory': (value) => {
    const files = (value.files as string[] | undefined) ?? [];
    return formatLogFields({ count: files.length, files });
  },
};

function summarizeResponse(method: string, result: unknown): string {
  if (method === 'cs-ide/fns-to-refactor' && Array.isArray(result)) {
    return summarizeFnsToRefactorResponse(result);
  }
  if (!isWireObject(result)) return '';
  return responseSummaries[method]?.(result) ?? '';
}

function reviewSummary(result: { score?: number; 'file-level-code-smells': unknown[]; 'function-level-code-smells': unknown[]; 'code-health-rules-error'?: unknown; 'git-blob-sha'?: string }): Record<string, unknown> {
  return {
    score: result.score,
    fileSmells: result['file-level-code-smells'].length,
    functionSmells: result['function-level-code-smells'].length,
    hasRulesError: result['code-health-rules-error'] !== undefined,
    sha: result['git-blob-sha'],
  };
}

function deltaSummary(
  result: {
    'old-score'?: number;
    'new-score'?: number;
    'score-change': number;
    'file-level-findings': unknown[];
    'function-level-findings': unknown[];
  } | null
): Record<string, unknown> {
  if (!result) return { result: 'null' };
  return {
    oldScore: result['old-score'],
    newScore: result['new-score'],
    scoreChange: result['score-change'],
    fileFindings: result['file-level-findings'].length,
    functionFindings: result['function-level-findings'].length,
  };
}

function summarizeFnToRefactor(value: unknown): string {
  if (!isWireObject(value)) return '(invalid)';
  const name = typeof value.name === 'string' ? value.name : '(unnamed)';
  const rangeLabel = fnRangeLabel(value.range);
  const categories = refactoringTargetCategories(value);
  return `${name}${rangeLabel ? `@${rangeLabel}` : ''}${categories.length ? `[${categories.join(', ')}]` : ''}`;
}

function fnRangeLabel(range: unknown): string | undefined {
  if (!isWireObject(range)) return undefined;
  const startLine = wireField<number>(range, 'startLine', 'start-line');
  const startColumn = wireField<number>(range, 'startColumn', 'start-column');
  const endLine = wireField<number>(range, 'endLine', 'end-line');
  const endColumn = wireField<number>(range, 'endColumn', 'end-column');
  if ([startLine, startColumn, endLine, endColumn].includes(undefined)) return undefined;
  return `${startLine}:${startColumn}-${endLine}:${endColumn}`;
}

function refactoringTargetCategories(fn: Record<string, unknown>): string[] {
  const targets = wireField<Array<{ category?: string }>>(fn, 'refactoringTargets', 'refactoring-targets') ?? [];
  return targets.map((target) => target.category).filter((category): category is string => !!category);
}
