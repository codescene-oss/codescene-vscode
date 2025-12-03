import { CodeSmell, Review } from '../devtools-api/review-model';
import { assertError, getWorkspaceCwd, networkErrors, rangeStr, reportError, safeJsonParse } from '../utils';
import { AceRequestEvent, CodeHealthRulesResult } from './model';
import {
  FnToRefactor,
  PreFlightResponse,
  RefactorResponse,
  REFACTOR_TASK_ID,
  TELEMETRY_POST_TASK_ID,
  TELEMETRY_DEVICE_ID_TASK_ID,
  DELTA_TASK_ID_PREFIX,
} from './refactor-models';

import { basename, dirname } from 'path';
import vscode, { ExtensionContext, TextDocument } from 'vscode';
import { CodeSceneAuthenticationSession } from '../auth/auth-provider';
import { getAuthToken } from '../configuration';
import { CsExtensionState, CsFeature } from '../cs-extension-state';
import { logOutputChannel } from '../log';
import { RefactoringRequest } from '../refactoring/request';
import { vscodeRange } from '../review/utils';
import { StatsCollector } from '../stats';
import { Delta } from './delta-model';
import { addRefactorableFunctionsToDeltaResult, jsonForScores } from './delta-utils';
import { TelemetryEvent, TelemetryResponse } from './telemetry-model';
import { ReviewCache } from './review-cache';
import { MissingAuthTokenError } from '../missing-auth-token-error';
import { DevtoolsAPIImpl, BinaryOpts } from './devtools-api-impl';
import { DevtoolsError } from './devtools-error';
import { AbortError } from './abort-error';

export class DevtoolsAPI {
  private static instance: DevtoolsAPIImpl;
  private static reviewCache: ReviewCache;

  static init(binaryPath: string, context: ExtensionContext) {
    DevtoolsAPI.instance = new DevtoolsAPIImpl(binaryPath, context);
    DevtoolsAPI.reviewCache = new ReviewCache(context);
  }

  static get concurrencyLimitingExecutor() {
    return DevtoolsAPI.instance.concurrencyLimitingExecutor;
  }

  static get networkError() {
    return DevtoolsAPI.instance?.networkError ?? false;
  }

  /**
   * Executes the command for creating a code health rules template.
   */
  static async codeHealthRulesTemplate() {
    const result = await DevtoolsAPI.instance.runBinary({ args: ['code-health-rules-template'], execOptions: { cwd: getWorkspaceCwd() } });
    return result.stdout;
  }

  /**
   * Executes the command for checking code health rule match against file
   */
  static async checkRules(rootPath: string, filePath: string) {
    const { stdout, stderr } = await DevtoolsAPI.instance.runBinary({
      args: ['check-rules', filePath],
      execOptions: { cwd: rootPath },
    });
    return { rulesMsg: stdout, errorMsg: stderr !== '' ? stderr : undefined } as CodeHealthRulesResult;
  }

  private static readonly analysisStateEmitter = new vscode.EventEmitter<AnalysisEvent>();
  /** Emits events when review or delta analysis state changes (running/idle?) */
  public static readonly onDidAnalysisStateChange = DevtoolsAPI.analysisStateEmitter.event;
  private static analysesRunning = 0;
  public static jobs = new Set<string>(); // Keep track of the filename of current jobs
  private static readonly analysisErrorEmitter = new vscode.EventEmitter<Error>();
  public static readonly onDidAnalysisFail = DevtoolsAPI.analysisErrorEmitter.event;

  // Adding to the jobs set if it's a delta analysis
  private static startAnalysisEvent(fileName: string, delta?: boolean) {
    delta && DevtoolsAPI.jobs.add(fileName);
    DevtoolsAPI.analysesRunning++;
    DevtoolsAPI.analysisStateEmitter.fire({ state: 'running', jobs: DevtoolsAPI.jobs });
  }

  private static endAnalysisEvent(fileName: string, delta?: boolean) {
    delta && DevtoolsAPI.jobs.delete(fileName); // Remove filename from jobs list on completed delta analysis
    DevtoolsAPI.analysesRunning--;
    if (DevtoolsAPI.analysesRunning === 0) {
      DevtoolsAPI.analysisStateEmitter.fire({ state: 'idle' });
    }
  }

  private static readonly reviewEmitter = new vscode.EventEmitter<ReviewEvent>();
  public static readonly onDidReviewComplete = DevtoolsAPI.reviewEmitter.event;

  static async reviewContent(document: vscode.TextDocument) {
    const fp = fileParts(document);
    const cachePath = DevtoolsAPI.reviewCache.getCachePath();
    const binaryOpts = {
      args: ['review', '--output-format', 'json', '--file-name', fp.fileName].concat(
        cachePath ? ['--cache-path', cachePath] : []
      ),
      taskId: taskId('review', document),
      execOptions: { cwd: fp.documentDirectory },
      input: document.getText(),
    };

    DevtoolsAPI.startAnalysisEvent(document.fileName);
    try {
      const reviewResult = await DevtoolsAPI.review(document, binaryOpts);
      if (reviewResult['code-health-rules-error']) {
        // TODO - maybe show a popup notification? Might become spammy when having multiple files open...
        const { description, remedy } = reviewResult['code-health-rules-error'];
        logOutputChannel.warn(`${description}`);
        logOutputChannel.warn(`${remedy}`);
      }
      DevtoolsAPI.reviewEmitter.fire({ document, result: reviewResult });
      return reviewResult;
    } catch (e) {
      if (!(e instanceof AbortError)) {
        DevtoolsAPI.analysisErrorEmitter.fire(assertError(e));
      }
    } finally {
      DevtoolsAPI.endAnalysisEvent(document.fileName);
    }
  }

  static async reviewBaseline(baselineCommit: string, document: vscode.TextDocument) {
    const fp = fileParts(document);
    const cachePath = DevtoolsAPI.reviewCache.getCachePath();

    const path = `${baselineCommit}:./${fp.fileName}`;

    const binaryOpts = {
      args: ['review', '--output-format', 'json', path].concat(cachePath ? ['--cache-path', cachePath] : []),
      taskId: taskId('review-base', document),
      execOptions: { cwd: fp.documentDirectory },
    };

    DevtoolsAPI.startAnalysisEvent(document.fileName);
    try {
      return await DevtoolsAPI.review(document, binaryOpts);
    } catch (e) {
      if (e instanceof DevtoolsError) {
        // Just return on regular devtoolerrors - this just means that we don't have any baseline to compare to
        return;
      }
      if (!(e instanceof AbortError)) {
        DevtoolsAPI.analysisErrorEmitter.fire(assertError(e));
      }
      throw e;
    } finally {
      DevtoolsAPI.endAnalysisEvent(document.fileName);
    }
  }

  private static async review(document: TextDocument, opts: BinaryOpts) {
    const { stdout, duration } = await DevtoolsAPI.instance.runBinary(opts);
    StatsCollector.instance.recordAnalysis(document.fileName, duration);
    return safeJsonParse(stdout) as Review;
  }

  static abortReviews(document: TextDocument) {
    DevtoolsAPI.instance.concurrencyLimitingExecutor.abort(taskId('review', document));
    DevtoolsAPI.instance.concurrencyLimitingExecutor.abort(taskId('review-base', document));
  }

  private static readonly deltaAnalysisEmitter = new vscode.EventEmitter<DeltaAnalysisEvent>();
  public static readonly onDidDeltaAnalysisComplete = DevtoolsAPI.deltaAnalysisEmitter.event;

  /**
   * Runs delta analysis and returns the result. Also fires onDidDeltaAnalysisComplete when analysis is complete.
   *
   * @param document
   * @param updateMonitor whether to update the Code Health Monitor tree view
   * @param oldScore raw base64 encoded score
   * @param newScore raw base64 encoded score
   * @returns Delta if any changes were detected or undefined when no improvements/degradations were found.
   */
  static async delta(document: TextDocument, updateMonitor: boolean, oldScore?: string | void, newScore?: string | void) {
    const inputJsonString = jsonForScores(oldScore, newScore);
    if (!inputJsonString) {
      logOutputChannel.debug(`Delta analysis skipped for ${basename(document.fileName)}: no input scores`);
      return;
    }

    DevtoolsAPI.startAnalysisEvent(document.fileName, true);
    try {
      const fp = fileParts(document);
      const result = await DevtoolsAPI.instance.runBinary({
        args: ['delta', '--output-format', 'json'],
        input: inputJsonString,
        taskId: taskId(DELTA_TASK_ID_PREFIX, document),
        execOptions: { cwd: fp.documentDirectory },
      });
      let deltaResult;
      if (result.stdout !== '') {
        // stdout === '' means there were no changes detected - return undefined to indicate this
        deltaResult = safeJsonParse(result.stdout) as Delta;
        await addRefactorableFunctionsToDeltaResult(document, deltaResult);
        logOutputChannel.info(`Delta analysis completed for ${basename(document.fileName)}: score-change=${deltaResult['score-change']}`);
      } else {
        logOutputChannel.debug(`Delta analysis completed for ${basename(document.fileName)}: no changes detected`);
      }
      DevtoolsAPI.deltaAnalysisEmitter.fire({ document, result: deltaResult, updateMonitor });
      return deltaResult;
    } catch (e) {
      const error = assertError(e);
      if (!(e instanceof AbortError)) {
        logOutputChannel.error(`Delta analysis failed for ${basename(document.fileName)}: ${error.message}`);
        if (error.stack) {
          logOutputChannel.error(`Stack trace: ${error.stack}`);
        }
      }
      if (DevtoolsAPI.shouldHandleOfflineBehavior(e)) {
        DevtoolsAPI.handleOfflineBehavior();
        return;
      }

      if (!(e instanceof AbortError)) {
        DevtoolsAPI.analysisErrorEmitter.fire(assertError(e));
        reportError({ context: 'Refactoring (delta operation) failed', e });
      }
    } finally {
      DevtoolsAPI.endAnalysisEvent(document.fileName, true);
    }
  }

  // Event emitters for devtools API callbacks
  private static readonly preflightRequestEmitter = new vscode.EventEmitter<CsFeature>();
  public static readonly onDidChangePreflightState = DevtoolsAPI.preflightRequestEmitter.event; // (successful preflight is synonymous with activation)

  /**
   * Do a new preflight request and update the internal json used by subsequent fnsToRefactor calls
   *
   * Fires onDidChangePreflightState
   *
   * @returns preflightResponse
   */
  static async preflight() {
    const args = ['refactor', 'preflight'];
    DevtoolsAPI.preflightRequestEmitter.fire({ state: 'loading' });
    try {
      const response = await DevtoolsAPI.instance.executeAsJson<PreFlightResponse>({ args, execOptions: { cwd: getWorkspaceCwd() } });
      DevtoolsAPI.instance.preflightJson = JSON.stringify(response);
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
    return DevtoolsAPI.instance.preflightJson !== undefined;
  }

  static disableAce() {
    DevtoolsAPI.instance.preflightJson = undefined;
    DevtoolsAPI.preflightRequestEmitter.fire({ state: 'disabled' });
  }

  static async fnsToRefactorFromDelta(document: TextDocument, delta: Delta) {
    return this.fnsToRefactor(document, ['--delta-result', JSON.stringify(delta)]);
  }

  /**
   * If no preflight json is available, ACE is considered disabled. No functions will
   * be presented as refactorable by early return here.
   */
  private static async fnsToRefactor(document: TextDocument, args: string[]) {
    if (!DevtoolsAPI.aceEnabled()) return;
    logOutputChannel.debug(`Calling fns-to-refactor for ${basename(document.fileName)}`);
    const fp = fileParts(document);
    const cachePath = DevtoolsAPI.reviewCache.getCachePath();
    const baseArgs = [
      'refactor',
      'fns-to-refactor',
      '--file-name',
      fp.fileName,
      '--preflight',
      DevtoolsAPI.instance.preflightJson!, // aceEnabled() implies preflightJson is defined
    ];
    const ret = await DevtoolsAPI.instance.executeAsJson<FnToRefactor[]>({
      args: baseArgs.concat(
        args,
        cachePath ? ['--cache-path', cachePath] : []
      ),
      input: document.getText(),
      execOptions: { cwd: fp.documentDirectory },
    });
    ret.forEach((fn) => (fn.vscodeRange = vscodeRange(fn.range)!));
    logOutputChannel.debug(
      `Completed fns-to-refactor for ${basename(document.fileName)}, found ${ret.length} function(s)`
    );
    return ret;
  }

  private static readonly refactoringRequestEmitter = new vscode.EventEmitter<AceRequestEvent>();
  public static readonly onDidRefactoringRequest = DevtoolsAPI.refactoringRequestEmitter.event;
  private static readonly refactoringErrorEmitter = new vscode.EventEmitter<Error>();
  public static readonly onDidRefactoringFail = DevtoolsAPI.refactoringErrorEmitter.event;

  private static buildRefactoringArgs(fnToRefactor: FnToRefactor, skipCache: boolean, token: string): string[] {
    const args = ['refactor', 'post'];

    if (fnToRefactor['nippy-b64']) {
      // If available, use the newer, more recommended API which isn't to encoding errors
      args.push('--fn-to-refactor-nippy-b64', fnToRefactor['nippy-b64']);
    } else {
      args.push('--fn-to-refactor', JSON.stringify(fnToRefactor));
    }

    if (skipCache) args.push('--skip-cache');

    args.push('--token', token);

    return args;
  }

  /**
   * Posts a refactoring using devtools binary
   *
   * Fires onDidRefactoringRequest and ondidRefactoringFail events
   *
   * @param request refactoring request
   * @returns refactoring response
   */
  static async postRefactoring(request: RefactoringRequest): Promise<RefactorResponse> {
    const { document, fnToRefactor, skipCache, signal } = request;

    const token = getEffectiveToken();
    if (!token) {
      throw new MissingAuthTokenError();
    }

    DevtoolsAPI.refactoringRequestEmitter.fire({ document, request, type: 'start' });
    try {
      const args = DevtoolsAPI.buildRefactoringArgs(fnToRefactor, skipCache, token);

      logOutputChannel.info(
        `Refactor requested for ${logIdString(fnToRefactor)}${
skipCache === true ? ' (retry)' : ''
}, with refactoring targets: [${fnToRefactor['refactoring-targets'].map((t) => t.category).join(', ')}]`
      );
      const fp = fileParts(document);
      const response = await DevtoolsAPI.instance.executeAsJson<RefactorResponse>({
        args,
        execOptions: { signal, cwd: fp.documentDirectory },
        taskId: REFACTOR_TASK_ID, // Limit to only 1 refactoring at a time
      });
      logOutputChannel.info(
        `Refactor request done ${logIdString(fnToRefactor, response['trace-id'])}${
skipCache === true ? ' (retry)' : ''
}`
      );

      DevtoolsAPI.handleBackOnline();

      return response;
    } catch (e) {
      if (DevtoolsAPI.shouldHandleOfflineBehavior(e)) {
        DevtoolsAPI.handleOfflineBehavior();
      } else {
        reportError({ context: 'Refactoring error', e, consoleOnly: true });
        if (!(e instanceof AbortError)) {
          DevtoolsAPI.refactoringErrorEmitter.fire(assertError(e));
        }
      }

      throw e; // Some general error reporting above, but pass along the error for further handling
    } finally {
      DevtoolsAPI.refactoringRequestEmitter.fire({ document, request, type: 'end' });
    }
  }

  static postTelemetry(event: TelemetryEvent) {
    const jsonEvent = JSON.stringify(event);
    return DevtoolsAPI.instance.executeAsJson<TelemetryResponse>({
      args: ['telemetry', '--event', jsonEvent],
      execOptions: { cwd: getWorkspaceCwd() },
      taskId: TELEMETRY_POST_TASK_ID
    });
  }

  static async getDeviceId() {
    return (await DevtoolsAPI.instance.runBinary({
      args: ['telemetry', '--device-id'],
      execOptions: { cwd: getWorkspaceCwd() },
      taskId: TELEMETRY_DEVICE_ID_TASK_ID
    })).stdout;
  }

  private static shouldHandleOfflineBehavior(e: unknown): boolean {
    const message = (e as Error).message;

    if (message === networkErrors.javaConnectException) {
      return true;
    }

    return false;
  }

  /**
   * Handles the transition of the ACE feature into offline mode.
   *
   * This method should be called when a network-related error is detected.
   * It performs the following actions:
   * - If not already offline, shows an information message to the user that the extension
   *   is running in offline mode and some features may be unavailable.
   * - Logs a warning in the output channel with additional context.
   * - Fires a preflight event to update the ACE state to `offline`.
   */
  private static handleOfflineBehavior() {
    const { state: currentState } = CsExtensionState.stateProperties.features.ace;

    // Only show when transitioning to offline mode
    if (currentState !== 'offline') {
      void vscode.window.showInformationMessage(
        'CodeScene extension is running in offline mode. Some features may be unavailable.'
      );
    }

    logOutputChannel.warn(
      'CodeScene extension is running in offline mode. The requested action could not be completed. Please check your internet connection to restore full functionality.'
    );

    DevtoolsAPI.preflightRequestEmitter.fire({ state: 'offline' });
  }

  /**
   * Restores the ACE feature state when the extension comes back online.
   * This method should be called after a successful request to the CodeScene backend.
   * No action is taken if the ACE feature state is not `offline`.
   */
  private static handleBackOnline() {
    const { state: currentState } = CsExtensionState.stateProperties.features.ace;
    if (currentState === 'offline') {
      DevtoolsAPI.preflightRequestEmitter.fire({ state: 'enabled' });
      void vscode.window.showInformationMessage('CodeScene extension is back online.');
    }
  }

  static dispose() {
    try { DevtoolsAPI.instance?.concurrencyLimitingExecutor.dispose(); } catch {}
    try { DevtoolsAPI.analysisStateEmitter.dispose(); } catch {}
    try { DevtoolsAPI.analysisErrorEmitter.dispose(); } catch {}
    try { DevtoolsAPI.reviewEmitter.dispose(); } catch {}
    try { DevtoolsAPI.deltaAnalysisEmitter.dispose(); } catch {}
    try { DevtoolsAPI.preflightRequestEmitter.dispose(); } catch {}
    try { DevtoolsAPI.refactoringRequestEmitter.dispose(); } catch {}
    try { DevtoolsAPI.refactoringErrorEmitter.dispose(); } catch {}
  }
}

type CmdId = 'review' | 'review-base' | 'delta';
function taskId(cmdId: CmdId, document: TextDocument) {
  return `${cmdId} ${document.fileName} v${document.version}`;
}

interface FileParts {
  fileName: string;
  documentDirectory: string;
}
function fileParts(document: vscode.TextDocument): FileParts {
  const fileName = basename(document.fileName);

  // Get the fsPath of the current document because we want to execute the
  // 'cs review' command in the same directory as the current document
  // (i.e. inside the repo to pick up on any .codescene/code-health-config.json file)
  const documentDirectory = dirname(document.fileName);
  return { fileName, documentDirectory };
}

export function isCodeSceneSession(x: vscode.AuthenticationSession): x is CodeSceneAuthenticationSession {
  return (<CodeSceneAuthenticationSession>x).url !== undefined;
}

export function getEffectiveToken(): string | undefined {
  const configToken = getAuthToken();
  const session = CsExtensionState.stateProperties.session;
  const sessionToken = session && isCodeSceneSession(session) ? session.accessToken : undefined;

  const token = configToken || sessionToken;
  return token && token.trim() !== '' ? token : undefined;
}

export function logIdString(fnToRefactor: FnToRefactor, traceId?: string) {
  return `[traceId ${traceId ? traceId : 'n/a'}] "${fnToRefactor.name}" ${rangeStr(fnToRefactor.vscodeRange)}`;
}


export type AnalysisEvent = {
  state: 'running' | 'idle';
  jobs?: Set<string>;
};

export type ReviewEvent = {
  document: vscode.TextDocument;
  result?: Review;
};

export type DeltaAnalysisEvent = {
  document: vscode.TextDocument;
  result?: Delta;
  updateMonitor: boolean; // Please set this to false if triggering reviews due to opening files, and to true if triggering reviews due to Git changes.
};
