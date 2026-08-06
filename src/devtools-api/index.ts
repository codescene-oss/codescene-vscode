import { CodeSmell, Review } from './review-model';
import { assertError, getWorkspaceCwd, networkErrors, rangeStr, reportError } from '../utils';
import { AceRequestEvent, CodeHealthRulesResult } from './model';
import { FnToRefactor, RefactorResponse } from './refactor-models';
import { basename, dirname } from 'path';
import { existsSync } from 'fs';
import vscode, { ExtensionContext, TextDocument } from 'vscode';
import { CodeSceneAuthenticationSession } from '../auth/auth-provider';
import { ACE_ENABLED } from '../build-flags';
import { getAuthToken } from '../configuration';
import { CsExtensionState, CsFeature } from '../cs-extension-state';
import { logOutputChannel } from '../log';
import { RefactoringRequest } from '../refactoring/request';
import { vscodeRange } from '../review/utils';
import { Delta } from './delta-model';
import { addRefactorableFunctionsToDeltaResult } from './delta-utils';
import { TelemetryEvent, TelemetryResponse } from './telemetry-model';
import { ReviewCache } from './review-cache';
import { MissingAuthTokenError } from '../missing-auth-token-error';
import { AbortError } from './abort-error';
import { acquireGitApi, fireFileDeletedFromGit, getRepoRootPath } from '../git-utils';
import Reviewer, { ReviewOpts } from '../review/reviewer';
import { CsIdeServerClient, RefactorParams } from './ide-server-client';
import { v4 as uuid } from 'uuid';
import { PresentedDelta, PresentedReview, ReviewPipeline, ReviewPipelinePresentation } from '../review/review-pipeline';
import { CsReview } from '../review/cs-review';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { relativePosix } from '../utils/fs-paths';

export class DevtoolsAPI {
  private static reviewCache: ReviewCache;
  private static ideServer: CsIdeServerClient;
  private static pipeline: ReviewPipeline;
  private static lastNetworkError = false;

  static init(binaryPath: string, context: ExtensionContext, unused?: unknown, ideServer?: CsIdeServerClient) {
    DevtoolsAPI.pipeline?.dispose();
    DevtoolsAPI.ideServer?.dispose();
    void unused;
    DevtoolsAPI.reviewCache = new ReviewCache(context);
    DevtoolsAPI.ideServer = ideServer ?? new CsIdeServerClient(binaryPath);
    DevtoolsAPI.pipeline = new ReviewPipeline(DevtoolsAPI.ideServer, DevtoolsAPI.pipelinePresentation(), uuid);
  }

  static get reviewPipeline(): ReviewPipeline {
    return DevtoolsAPI.pipeline;
  }

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
  public static get isAnalysisRunning(): boolean {
    return DevtoolsAPI.analysesRunning > 0;
  }
  public static setAnalysesRunningForTesting(count: number): void {
    DevtoolsAPI.analysesRunning = count;
  }
  public static jobs = new Set<string>();
  private static readonly analysisErrorEmitter = new vscode.EventEmitter<Error>();
  public static readonly onDidAnalysisFail = DevtoolsAPI.analysisErrorEmitter.event;

  private static startAnalysisEvent(fileName: string, delta?: boolean) {
    if (delta) DevtoolsAPI.jobs.add(fileName);
    DevtoolsAPI.analysesRunning++;
    DevtoolsAPI.analysisStateEmitter.fire({ state: 'running', jobs: DevtoolsAPI.jobs });
  }

  private static endAnalysisEvent(fileName: string, delta?: boolean) {
    if (delta) DevtoolsAPI.jobs.delete(fileName);
    DevtoolsAPI.analysesRunning--;
    if (DevtoolsAPI.analysesRunning === 0) DevtoolsAPI.analysisStateEmitter.fire({ state: 'idle' });
  }

  private static readonly reviewEmitter = new vscode.EventEmitter<ReviewEvent>();
  public static readonly onDidReviewComplete = DevtoolsAPI.reviewEmitter.event;

  static reviewWithServer(document: vscode.TextDocument, reviewOpts?: ReviewOpts): Promise<Review | void> {
    const repoRoot = DevtoolsAPI.repoRootFor(document);
    const baselineRevision = reviewOpts?.baselineCommit ?? '';
    return DevtoolsAPI.pipeline.submit(repoRoot, baselineRevision, baselineRevision, {
      document,
      relPath: relativePosix(repoRoot, document.fileName),
      content: document.getText(),
      updateDiagnosticsPane: reviewOpts?.updateDiagnosticsPane ?? false,
      updateMonitor: !(reviewOpts?.skipMonitorUpdate ?? false),
    });
  }

  static reviewContent(document: vscode.TextDocument): Promise<Review | void> {
    return DevtoolsAPI.reviewWithServer(document);
  }

  static reviewBaseline(baselineCommit: string, document: vscode.TextDocument): Promise<Review | void> {
    return DevtoolsAPI.reviewWithServer(document, {
      baselineCommit,
      skipMonitorUpdate: false,
      updateDiagnosticsPane: false,
    });
  }

  static async delta(
    document: vscode.TextDocument,
    updateMonitor: boolean,
    oldScore?: string | void,
    newScore?: string | void
  ): Promise<Delta | undefined> {
    void document;
    void updateMonitor;
    void oldScore;
    void newScore;
    return undefined;
  }

  static abortReviews(document: TextDocument): void {
    void document;
  }

  private static repoRootFor(document: vscode.TextDocument): string {
    const repo = acquireGitApi()?.getRepository(document.uri);
    return repo ? getRepoRootPath(repo) : getWorkspaceCwd();
  }

  static usesIdeServer(): boolean {
    return true;
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

  private static presentServerReview({ document, result, updateDiagnosticsPane, updateMonitor, baselineRevision }: PresentedReview): void {
    const review = new CsReview(document, Promise.resolve(result));
    Reviewer.instance.updateOrAdd(document, review, !updateMonitor, updateDiagnosticsPane, baselineRevision);
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
    Reviewer.instance.reviewCache.get(document, 'any')?.setDelta(normalized);
    DevtoolsAPI.deltaAnalysisEmitter.fire({ document, result: normalized, updateMonitor });
    if (normalized) void DevtoolsAPI.enrichServerDelta(document, normalized);
  }

  private static async enrichServerDelta(document: TextDocument, result: Delta): Promise<void> {
    try {
      await addRefactorableFunctionsToDeltaResult(document, result);
      DevtoolsAPI.deltaAnalysisEmitter.fire({ document, result, updateMonitor: true });
    } catch (error) {
      logOutputChannel.warn(`[cs-ide] could not enrich delta for ${document.fileName}: ${assertError(error).message}`);
    }
  }

  private static removeServerReview(document: TextDocument): void {
    CsDiagnostics.set(document.uri, []);
    Reviewer.instance.reviewCache.delete(document.uri.fsPath);
    fireFileDeletedFromGit(document.uri.fsPath);
  }

  private static readonly deltaAnalysisEmitter = new vscode.EventEmitter<DeltaAnalysisEvent>();
  public static readonly onDidDeltaAnalysisComplete = DevtoolsAPI.deltaAnalysisEmitter.event;
  private static readonly preflightRequestEmitter = new vscode.EventEmitter<CsFeature>();
  public static readonly onDidChangePreflightState = DevtoolsAPI.preflightRequestEmitter.event;
  private static preflightJson?: string;

  static async preflight() {
    if (!ACE_ENABLED) return;
    DevtoolsAPI.preflightRequestEmitter.fire({ state: 'loading' });
    try {
      const response = await DevtoolsAPI.ideServer.preflight();
      DevtoolsAPI.preflightJson = JSON.stringify(response);
      DevtoolsAPI.preflightRequestEmitter.fire({ state: 'enabled' });
      return response;
    } catch (e) {
      if (DevtoolsAPI.shouldHandleOfflineBehavior(e)) {
        DevtoolsAPI.handleOfflineBehavior();
        return;
      }
      DevtoolsAPI.preflightRequestEmitter.fire({ state: 'error', error: assertError(e) });
      reportError({ context: 'Unable to enable refactoring capabilities', e });
    }
  }

  static aceEnabled() {
    return ACE_ENABLED && DevtoolsAPI.preflightJson !== undefined;
  }

  static disableAce() {
    if (!ACE_ENABLED) return;
    DevtoolsAPI.preflightJson = undefined;
    DevtoolsAPI.preflightRequestEmitter.fire({ state: 'disabled' });
  }

  static async fnsToRefactorFromDelta(document: TextDocument, delta: Delta) {
    return this.fnsToRefactor(document, { 'delta-result': delta });
  }

  static async fnsToRefactor(document: TextDocument, args: { 'delta-result': Delta } | { 'code-smells': [CodeSmell] }) {
    if (!DevtoolsAPI.aceEnabled()) return;
    logOutputChannel.debug(`Calling fns-to-refactor for ${basename(document.fileName)}`);
    const fp = fileParts(document);
    if (!validateFileParts('fnsToRefactor', fp, document)) return;
    const cachePath = DevtoolsAPI.reviewCache.getCachePath();
    const ret = await DevtoolsAPI.ideServer.fnsToRefactor({
      'file-name': fp.fileName,
      'file-content': document.getText(),
      preflight: JSON.parse(DevtoolsAPI.preflightJson!),
      ...(cachePath ? { 'cache-path': cachePath } : {}),
      ...args,
    });
    ret.forEach((fn) => (fn.vscodeRange = vscodeRange(fn.range)!));
    logOutputChannel.debug(`Completed fns-to-refactor for ${basename(document.fileName)}, found ${ret.length} function(s)`);
    return ret;
  }

  private static readonly refactoringRequestEmitter = new vscode.EventEmitter<AceRequestEvent>();
  public static readonly onDidRefactoringRequest = DevtoolsAPI.refactoringRequestEmitter.event;
  private static readonly refactoringErrorEmitter = new vscode.EventEmitter<Error>();
  public static readonly onDidRefactoringFail = DevtoolsAPI.refactoringErrorEmitter.event;

  private static buildRefactoringPayload(fnToRefactor: FnToRefactor, skipCache: boolean, token: string): RefactorParams {
    const payload: RefactorParams = { token };
    if (fnToRefactor['nippy-b64']) payload['fn-to-refactor-nippy-b64'] = fnToRefactor['nippy-b64'];
    else payload['fn-to-refactor'] = fnToRefactor;
    if (skipCache) payload['skip-cache'] = true;
    return payload;
  }

  static async postRefactoring(request: RefactoringRequest): Promise<RefactorResponse> {
    this.checkAceEnabled();
    const { document, fnToRefactor, skipCache, signal } = request;
    const token = this.getRefactoringAuthToken();
    DevtoolsAPI.refactoringRequestEmitter.fire({ document, request, type: 'start' });
    try {
      const payload = DevtoolsAPI.buildRefactoringPayload(fnToRefactor, skipCache, token);
      this.logRefactorRequested(fnToRefactor, skipCache);
      this.validateRefactoringDocument(document);
      const response = await DevtoolsAPI.ideServer.refactor(payload, signal);
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

  private static getRefactoringAuthToken(): string {
    const token = getEffectiveToken();
    if (!token) throw new MissingAuthTokenError();
    return token;
  }

  private static logRefactorRequested(fnToRefactor: FnToRefactor, skipCache: boolean): void {
    logOutputChannel.info(`Refactor requested for ${logIdString(fnToRefactor)}${skipCache ? ' (retry)' : ''}, with refactoring targets: [${fnToRefactor['refactoring-targets'].map((target) => target.category).join(', ')}]`);
  }

  private static validateRefactoringDocument(document: TextDocument): void {
    const fp = fileParts(document);
    if (!validateFileParts('postRefactoring', fp, document)) {
      throw new Error('Invalid file parts: document directory is missing or does not exist');
    }
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
    DevtoolsAPI.preflightRequestEmitter.fire({ state: 'offline' });
  }

  private static handleBackOnline() {
    DevtoolsAPI.lastNetworkError = false;
    if (ACE_ENABLED && CsExtensionState.stateProperties.features.ace.state === 'offline') {
      DevtoolsAPI.preflightRequestEmitter.fire({ state: 'enabled' });
      void vscode.window.showInformationMessage('CodeScene extension is back online.');
    }
  }

  static dispose() {
    DevtoolsAPI.pipeline?.dispose();
    DevtoolsAPI.ideServer?.dispose();
    try { DevtoolsAPI.analysisStateEmitter.dispose(); } catch {}
    try { DevtoolsAPI.analysisErrorEmitter.dispose(); } catch {}
    try { DevtoolsAPI.reviewEmitter.dispose(); } catch {}
    try { DevtoolsAPI.deltaAnalysisEmitter.dispose(); } catch {}
    try { DevtoolsAPI.preflightRequestEmitter.dispose(); } catch {}
    try { DevtoolsAPI.refactoringRequestEmitter.dispose(); } catch {}
    try { DevtoolsAPI.refactoringErrorEmitter.dispose(); } catch {}
  }
}

interface FileParts {
  fileName: string;
  documentDirectory: string;
}

function fileParts(document: vscode.TextDocument): FileParts {
  return { fileName: basename(document.fileName), documentDirectory: dirname(document.fileName) };
}

function validateFileParts(operation: string, fp: FileParts, document: vscode.TextDocument): boolean {
  if (!fp.documentDirectory?.trim()) {
    logOutputChannel.warn(`Operation ${operation} skipped for ${basename(document.fileName)}: document directory is empty`);
    return false;
  }
  let exists = true;
  try { exists = existsSync(fp.documentDirectory); } catch {}
  if (!exists) {
    logOutputChannel.warn(`Operation ${operation} skipped for ${basename(document.fileName)}: document directory does not exist: ${fp.documentDirectory}`);
    return false;
  }
  return true;
}

export function isCodeSceneSession(x: vscode.AuthenticationSession): x is CodeSceneAuthenticationSession {
  return (x as CodeSceneAuthenticationSession).url !== undefined;
}

export function getEffectiveToken(): string | undefined {
  const configToken = getAuthToken();
  const session = CsExtensionState.stateProperties.session;
  const sessionToken = session && isCodeSceneSession(session) ? session.accessToken : undefined;
  const token = configToken || sessionToken;
  return token?.trim() ? token : undefined;
}

export function logIdString(fnToRefactor: FnToRefactor, traceId?: string) {
  return `[traceId ${traceId ?? 'n/a'}] "${fnToRefactor.name}" ${rangeStr(fnToRefactor.vscodeRange)}`;
}

export type AnalysisEvent = { state: 'running' | 'idle'; jobs?: Set<string> };
export type ReviewEvent = { document: vscode.TextDocument; result?: Review };
export type DeltaAnalysisEvent = { document: vscode.TextDocument; result?: Delta; updateMonitor: boolean };
