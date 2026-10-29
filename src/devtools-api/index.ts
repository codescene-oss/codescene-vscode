import { Review } from './review-model';
import { assertError, getWorkspaceCwd, networkErrors, rangeStr, reportError } from '../utils';
import { AceRequestEvent, CodeHealthRulesResult } from './model';
import { FnToRefactor, RefactorResponse } from './refactor-models';
import vscode, { ExtensionContext, TextDocument } from 'vscode';
import { isAceAvailable, refactorToken, resolveAceToken } from '../auth/ace-credential';
import { ACE_ENABLED } from '../build-flags';
import { getAuthToken, automaticAnalysisEnabled } from '../configuration';
import { CsExtensionState, CsFeature } from '../cs-extension-state';
import { logOutputChannel } from '../log';
import { RefactoringRequest } from '../refactoring/request';
import { AgentRefactoringService, ProgressCallback } from '../refactoring/agent-service';
import { Delta } from './delta-model';
import { fnToRefactorForFinding } from '../refactoring/fn-to-refactor';
import { TelemetryEvent, TelemetryResponse } from './telemetry-model';
import { AbortError } from './abort-error';
import { acquireGitApi, fireFileDeletedFromGit, getRepoRootPath } from '../git-utils';
import Reviewer, { ReviewOpts } from '../review/reviewer';
import { CsIdeServerClient, ReviewQueue, ServerStartEvent, WatchInventory } from './ide-server-client';
import { v4 as uuid } from 'uuid';
import { PresentedDelta, PresentedReview, ReviewPipeline, ReviewPipelinePresentation } from '../review/review-pipeline';
import { CsReview } from '../review/cs-review';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { relativePosix } from '../utils/fs-paths';

export class DevtoolsAPI {
  private static ideServer: CsIdeServerClient;
  private static pipeline: ReviewPipeline;
  private static queueSubscription?: vscode.Disposable;
  private static lastNetworkError = false;

  static init(binaryPath: string, context: ExtensionContext, ideServer?: CsIdeServerClient) {
    DevtoolsAPI.pipeline?.dispose();
    DevtoolsAPI.queueSubscription?.dispose();
    DevtoolsAPI.ideServer?.dispose();
    DevtoolsAPI.ideServer = ideServer ?? new CsIdeServerClient(binaryPath);
    DevtoolsAPI.pipeline = new ReviewPipeline(DevtoolsAPI.ideServer, DevtoolsAPI.pipelinePresentation(), uuid);
    DevtoolsAPI.queueCount = 0;
    DevtoolsAPI.queueDone = 0;
    DevtoolsAPI.queued = [];
    DevtoolsAPI.queueSubscription = DevtoolsAPI.ideServer.onDidQueue((queue) => DevtoolsAPI.applyQueue(queue));
  }

  static get reviewPipeline(): ReviewPipeline {
    return DevtoolsAPI.pipeline;
  }

  static watchFiles(repoRoot: string, relativePaths?: string[]): void {
    DevtoolsAPI.ideServer.watchFiles(repoRoot, relativePaths);
  }

  static stopWatchFiles(repoRoot: string, relativePaths?: string[]): void {
    DevtoolsAPI.ideServer.stopWatchFiles(repoRoot, relativePaths);
  }

  static getWatchInventory(repoRoot: string): Promise<WatchInventory> {
    return DevtoolsAPI.ideServer.getWatchInventory(repoRoot);
  }

  static readonly onDidWatchInventory: vscode.Event<WatchInventory> = (listener, thisArgs?, disposables?) =>
    DevtoolsAPI.ideServer.onDidWatchInventory(listener, thisArgs, disposables);

  static readonly onDidServerStart: vscode.Event<ServerStartEvent> = (listener, thisArgs?, disposables?) =>
    DevtoolsAPI.ideServer.onDidServerStart(listener, thisArgs, disposables);

  static readonly onDidQueue: vscode.Event<ReviewQueue> = (listener, thisArgs?, disposables?) =>
    DevtoolsAPI.ideServer.onDidQueue(listener, thisArgs, disposables);

  static invalidateReviewEpoch(): void {
    DevtoolsAPI.pipeline?.invalidate();
  }

  static get networkError() {
    return DevtoolsAPI.lastNetworkError;
  }

  static async codeHealthRulesTemplate() {
    return (await DevtoolsAPI.ideServer.codeHealthRulesTemplate()).template;
  }

  static async checkRules(rootPath: string, filePath: string) {
    const { result, 'parsing-errors': parsingErrors, failed } = await DevtoolsAPI.ideServer.checkRules(rootPath, filePath);
    if (failed && parsingErrors?.length) {
      const errorMessages = parsingErrors.map((error) => error.message).join('\n');
      return {
        rulesMsg: result,
        errorMsg: `Problem in ruleset:\n${errorMessages}\nFailed to parse the code health rule set`,
      } as CodeHealthRulesResult;
    }
    return { rulesMsg: result } as CodeHealthRulesResult;
  }

  private static readonly analysisStateEmitter = new vscode.EventEmitter<AnalysisEvent>();
  public static readonly onDidAnalysisStateChange = DevtoolsAPI.analysisStateEmitter.event;
  private static analysesRunning = 0;
  public static jobs = new Set<string>();
  private static queueCount = 0;
  private static queueDone = 0;
  private static queued: string[] = [];
  private static readonly analysisErrorEmitter = new vscode.EventEmitter<Error>();
  public static readonly onDidAnalysisFail = DevtoolsAPI.analysisErrorEmitter.event;

  private static startAnalysisEvent(fileName: string, delta?: boolean) {
    if (delta) DevtoolsAPI.jobs.add(fileName);
    DevtoolsAPI.analysesRunning++;
    DevtoolsAPI.fireAnalysisState();
  }

  private static endAnalysisEvent(fileName: string, delta?: boolean) {
    if (delta) DevtoolsAPI.jobs.delete(fileName);
    DevtoolsAPI.analysesRunning--;
    DevtoolsAPI.fireAnalysisState();
  }

  private static applyQueue(snapshot: ReviewQueue): void {
    const queue = automaticAnalysisEnabled() ? snapshot : { count: 0, done: 0, files: [] };
    DevtoolsAPI.queueCount = queue.count;
    DevtoolsAPI.queueDone = queue.done;
    DevtoolsAPI.queued = queue.files;
    DevtoolsAPI.fireAnalysisState();
  }

  static clearQueue(): void {
    DevtoolsAPI.applyQueue({ count: 0, done: 0, files: [] });
  }

  private static fireAnalysisState(): void {
    const running = DevtoolsAPI.analysesRunning > 0 || DevtoolsAPI.queueCount > 0;
    DevtoolsAPI.analysisStateEmitter.fire({
      state: running ? 'running' : 'idle',
      jobs: DevtoolsAPI.jobs,
      queued: DevtoolsAPI.queued,
      queueCount: DevtoolsAPI.queueCount,
      queueDone: DevtoolsAPI.queueDone,
    });
  }

  private static readonly reviewEmitter = new vscode.EventEmitter<ReviewEvent>();
  public static readonly onDidReviewComplete = DevtoolsAPI.reviewEmitter.event;

  static reviewWithServer(document: vscode.TextDocument, reviewOpts?: ReviewOpts): Promise<Review | void> {
    const repoRoot = DevtoolsAPI.repoRootFor(document);
    return DevtoolsAPI.pipeline.submit(repoRoot, {
      document,
      relPath: relativePosix(repoRoot, document.fileName),
      content: document.getText(),
      updateDiagnosticsPane: reviewOpts?.updateDiagnosticsPane ?? false,
      updateMonitor: !(reviewOpts?.skipMonitorUpdate ?? false),
    });
  }

  static releaseBufferMonitorOwnership(document: vscode.TextDocument): void {
    DevtoolsAPI.pipeline.releaseBufferMonitorOwnership(DevtoolsAPI.repoRootFor(document), document);
  }

  static restoreFromDiskIfBufferOwned(document: vscode.TextDocument): void {
    DevtoolsAPI.pipeline.restoreFromDiskIfBufferOwned(DevtoolsAPI.repoRootFor(document), document);
  }

  private static repoRootFor(document: vscode.TextDocument): string {
    const repo = acquireGitApi()?.getRepository(document.uri);
    if (repo) return getRepoRootPath(repo);
    const cwd = getWorkspaceCwd();
    logOutputChannel.debug(`[cs-ide] repoRoot fallback path=${document.fileName} cwd=${cwd}`);
    return cwd;
  }

  private static pipelinePresentation(): ReviewPipelinePresentation {
    return {
      reviewStarted: (document) => DevtoolsAPI.startAnalysisEvent(document.fileName),
      reviewFinished: (document) => DevtoolsAPI.endAnalysisEvent(document.fileName),
      deltaStarted: (document) => DevtoolsAPI.startAnalysisEvent(document.fileName, true),
      deltaFinished: (document) => DevtoolsAPI.endAnalysisEvent(document.fileName, true),
      presentReview: (review) => DevtoolsAPI.presentServerReview(review),
      presentDelta: (delta) => DevtoolsAPI.presentServerDelta(delta),
      remove: (document) => DevtoolsAPI.removeServerReview(document),
      failed: (error) => DevtoolsAPI.analysisErrorEmitter.fire(error),
    };
  }

  private static presentServerReview({ document, result, updateDiagnosticsPane, updateMonitor }: PresentedReview): void {
    const review = new CsReview(document, Promise.resolve(result));
    Reviewer.instance.updateOrAdd(document, review, !updateMonitor);
    if (updateDiagnosticsPane) {
      void review.diagnostics.then((diagnostics) => CsDiagnostics.set(
        document.uri,
        diagnostics.filter((diagnostic) => diagnostic.codeSmell !== null)
      ));
    }
    DevtoolsAPI.reviewEmitter.fire({ document, result });
  }

  private static presentServerDelta({ document, result, updateMonitor }: PresentedDelta): void {
    const normalized = result ?? undefined;
    if (normalized) {
      normalized['file-level-findings'] ??= [];
      normalized['function-level-findings'] ??= [];
    }
    if (normalized && DevtoolsAPI.aceEnabled()) DevtoolsAPI.addRefactorableFunctions(document, normalized);
    Reviewer.instance.reviewCache.get(document, 'any')?.setDelta(normalized);
    DevtoolsAPI.deltaAnalysisEmitter.fire({ document, result: normalized, updateMonitor });
  }

  private static addRefactorableFunctions(document: TextDocument, delta: Delta): void {
    delta['function-level-findings'].forEach((finding) => {
      finding.refactorableFn = fnToRefactorForFinding(document, finding);
    });
  }

  private static removeServerReview(document: TextDocument): void {
    CsDiagnostics.set(document.uri, []);
    Reviewer.instance.reviewCache.delete(document.uri.fsPath);
    fireFileDeletedFromGit(document.uri.fsPath);
  }

  private static readonly deltaAnalysisEmitter = new vscode.EventEmitter<DeltaAnalysisEvent>();
  public static readonly onDidDeltaAnalysisComplete = DevtoolsAPI.deltaAnalysisEmitter.event;
  private static readonly aceStateEmitter = new vscode.EventEmitter<CsFeature>();
  public static readonly onDidChangeAceState = DevtoolsAPI.aceStateEmitter.event;
  private static aceActive = false;

  static enableAce() {
    if (!ACE_ENABLED) return;
    DevtoolsAPI.aceActive = true;
    DevtoolsAPI.aceStateEmitter.fire({ state: 'enabled' });
  }

  static aceEnabled() {
    return ACE_ENABLED && DevtoolsAPI.aceActive;
  }

  static disableAce() {
    if (!ACE_ENABLED) return;
    DevtoolsAPI.aceActive = false;
    DevtoolsAPI.aceStateEmitter.fire({ state: 'disabled' });
  }

  private static readonly refactoringRequestEmitter = new vscode.EventEmitter<AceRequestEvent>();
  public static readonly onDidRefactoringRequest = DevtoolsAPI.refactoringRequestEmitter.event;
  private static readonly refactoringErrorEmitter = new vscode.EventEmitter<Error>();
  public static readonly onDidRefactoringFail = DevtoolsAPI.refactoringErrorEmitter.event;

  static async postRefactoring(request: RefactoringRequest, onProgress?: ProgressCallback): Promise<RefactorResponse> {
    this.checkAceEnabled();
    const { document, fnToRefactor, skipCache, signal } = request;
    this.getRefactoringAuthToken();
    DevtoolsAPI.refactoringRequestEmitter.fire({ document, request, type: 'start' });
    try {
      this.logRefactorRequested(fnToRefactor, skipCache);
      const response = await DevtoolsAPI.executeRefactor(document, fnToRefactor, signal, onProgress);
      this.logRefactorDone(fnToRefactor, skipCache, response);
      DevtoolsAPI.handleBackOnline();
      return response;
    } catch (e) {
      DevtoolsAPI.handleRefactorError(e);
      throw e;
    } finally {
      DevtoolsAPI.refactoringRequestEmitter.fire({ document, request, type: 'end' });
    }
  }

  private static checkAceEnabled(): void {
    if (!ACE_ENABLED) throw new Error('ACE is not available in this build');
  }

  private static getRefactoringAuthToken(): string | undefined {
    return refactorToken(aceToken(), CsExtensionState.stateProperties.auth);
  }

  private static logRefactorRequested(fnToRefactor: FnToRefactor, skipCache: boolean): void {
    logOutputChannel.info(`Refactor requested for ${logIdString(fnToRefactor)}${skipCache ? ' (retry)' : ''}, with refactoring targets: [${fnToRefactor['refactoring-targets'].map((target) => target.category).join(', ')}]`);
  }

  private static async executeRefactor(
    document: TextDocument,
    fnToRefactor: FnToRefactor,
    signal: AbortSignal,
    onProgress?: ProgressCallback
  ): Promise<RefactorResponse> {
    return AgentRefactoringService.runRefactoring(document, fnToRefactor, signal, undefined, onProgress);
  }

  private static logRefactorDone(fnToRefactor: FnToRefactor, skipCache: boolean, response: RefactorResponse): void {
    logOutputChannel.info(`Refactor request done ${logIdString(fnToRefactor, response['trace-id'])}${skipCache ? ' (retry)' : ''}`);
  }

  private static handleRefactorError(e: unknown): void {
    if (DevtoolsAPI.shouldHandleOfflineBehavior(e)) DevtoolsAPI.handleOfflineBehavior();
    else {
      reportError({ context: 'Refactoring error', e, consoleOnly: true });
      if (!(e instanceof AbortError)) DevtoolsAPI.refactoringErrorEmitter.fire(assertError(e));
    }
  }

  static postTelemetry(event: TelemetryEvent): Promise<TelemetryResponse> {
    return DevtoolsAPI.ideServer.telemetry(event);
  }

  static async getDeviceId() {
    return (await DevtoolsAPI.ideServer.deviceId())['device-id'];
  }

  private static shouldHandleOfflineBehavior(e: unknown): boolean {
    return (e as Error).message === networkErrors.javaConnectException;
  }

  private static handleOfflineBehavior() {
    if (!ACE_ENABLED) return;
    DevtoolsAPI.lastNetworkError = true;
    if (CsExtensionState.stateProperties.features.ace.state !== 'offline') {
      void vscode.window.showInformationMessage('CodeScene extension is running in offline mode. Some features may be unavailable.');
    }
    logOutputChannel.warn('CodeScene extension is running in offline mode. The requested action could not be completed. Please check your internet connection to restore full functionality.');
    DevtoolsAPI.aceStateEmitter.fire({ state: 'offline' });
  }

  private static handleBackOnline() {
    DevtoolsAPI.lastNetworkError = false;
    if (ACE_ENABLED && CsExtensionState.stateProperties.features.ace.state === 'offline') {
      DevtoolsAPI.aceStateEmitter.fire({ state: 'enabled' });
      void vscode.window.showInformationMessage('CodeScene extension is back online.');
    }
  }

  static dispose() {
    DevtoolsAPI.pipeline?.dispose();
    DevtoolsAPI.queueSubscription?.dispose();
    DevtoolsAPI.ideServer?.dispose();
    try { DevtoolsAPI.analysisStateEmitter.dispose(); } catch {}
    try { DevtoolsAPI.analysisErrorEmitter.dispose(); } catch {}
    try { DevtoolsAPI.reviewEmitter.dispose(); } catch {}
    try { DevtoolsAPI.deltaAnalysisEmitter.dispose(); } catch {}
    try { DevtoolsAPI.aceStateEmitter.dispose(); } catch {}
    try { DevtoolsAPI.refactoringRequestEmitter.dispose(); } catch {}
    try { DevtoolsAPI.refactoringErrorEmitter.dispose(); } catch {}
  }
}

export function aceToken(): string | undefined {
  return resolveAceToken(getAuthToken(), CsExtensionState.stateProperties.legacySession?.accessToken);
}

export function aceAvailable(): boolean {
  return isAceAvailable(aceToken(), CsExtensionState.stateProperties.auth);
}

export function aceUsable(): boolean {
  return DevtoolsAPI.aceEnabled() && aceAvailable();
}

export function logIdString(fnToRefactor: FnToRefactor, traceId?: string) {
  return `[traceId ${traceId ?? 'n/a'}] "${fnToRefactor.name}" ${rangeStr(fnToRefactor.vscodeRange)}`;
}

export type AnalysisEvent = {
  state: 'running' | 'idle';
  jobs?: Set<string>;
  queued?: string[];
  queueCount?: number;
  queueDone?: number;
};
export type ReviewEvent = { document: vscode.TextDocument; result?: Review };
export type DeltaAnalysisEvent = {
  document: vscode.TextDocument;
  result?: Delta;
  updateMonitor: boolean;
};
