import { ExecOptions } from 'child_process';
import { CodeSmell, Review } from '../devtools-api/review-model';
import { Command, ExecResult, SingleTaskExecutor, SimpleExecutor, Task, ConcurrencyLimitingExecutor } from '../executor';
import { assertError, getFileExtension, networkErrors, rangeStr, reportError, safeJsonParse } from '../utils';
import { AceRequestEvent, CodeHealthRulesResult, DevtoolsError as DevtoolsErrorModel } from './model';
import {
  CreditsInfo,
  CreditsInfoError as CreditsInfoErrorModel,
  FnToRefactor,
  PreFlightResponse,
  RefactorResponse,
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

  /**
   * Executes the command for creating a code health rules template.
   */
  static async codeHealthRulesTemplate() {
    const result = await DevtoolsAPI.instance.runBinary({ args: ['code-health-rules-template'] });
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
   * @param oldScore raw base64 encoded score
   * @param newScore raw base64 encoded score
   * @returns Delta if any changes were detected or undefined when no improvements/degradations were found.
   */
  static async delta(document: TextDocument, oldScore?: string | void, newScore?: string | void) {
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
        taskId: taskId('delta', document),
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
      DevtoolsAPI.deltaAnalysisEmitter.fire({ document, result: deltaResult });
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
        reportError({ context: 'Unable to enable refactoring capabilities', e });
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
      const response = await DevtoolsAPI.instance.executeAsJson<PreFlightResponse>({ args });
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

  static async fnsToRefactorFromCodeSmell(document: TextDocument, codeSmell: CodeSmell) {
    const result = await this.fnsToRefactor(document, ['--code-smells', JSON.stringify([codeSmell])]);
    return result?.[0];
  }

  static async fnsToRefactorFromCodeSmells(document: TextDocument, codeSmells: CodeSmell[]) {
    if (codeSmells.length === 0) return [];
    return this.fnsToRefactor(document, ['--code-smells', JSON.stringify(codeSmells)]);
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
    const baseArgs = [
      'refactor',
      'fns-to-refactor',
      '--extension',
      getFileExtension(document.fileName),
      '--preflight',
      DevtoolsAPI.instance.preflightJson!, // aceEnabled() implies preflightJson is defined
    ];
    const ret = await DevtoolsAPI.instance.executeAsJson<FnToRefactor[]>({
      args: baseArgs.concat(args),
      input: document.getText(),
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
      const response = await DevtoolsAPI.instance.executeAsJson<RefactorResponse>({
        args,
        execOptions: { signal },
        taskId: 'refactor', // Limit to only 1 refactoring at a time
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
    return DevtoolsAPI.instance.executeAsJson<TelemetryResponse>({ args: ['telemetry', '--event', jsonEvent] });
  }

  static async getDeviceId() {
    return (await DevtoolsAPI.instance.runBinary({ args: ['telemetry', '--device-id'] })).stdout;
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
}

class DevtoolsAPIImpl {
  public simpleExecutor: SimpleExecutor = new SimpleExecutor();
  public concurrencyLimitingExecutor: ConcurrencyLimitingExecutor = new ConcurrencyLimitingExecutor(
    this.simpleExecutor
  );
  public preflightJson?: string;

  constructor(public binaryPath: string, context: ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand('codescene.printDevtoolsApiStats', () => {
        this.simpleExecutor.logStats();
        logOutputChannel.show();
      })
    );
  }

  /**
   * Runs the devtools binary
   *
   * @param opts Options for running the devtools binary
   * @returns stdout of the command
   * @throws Error, DevtoolsError or CreditsInfoError depending on exit code
   */
  async runBinary(opts: BinaryOpts) {
    const { args, execOptions, input, taskId } = opts;

    let result: ExecResult;
    if (taskId) {
      const task: Task = {
        command: this.binaryPath,
        args,
        taskId,
        ignoreError: true,
      };
      result = await this.concurrencyLimitingExecutor.execute(task, execOptions, input);
    } else {
      const command: Command = {
        command: this.binaryPath,
        args,
        ignoreError: true,
      };
      result = await this.simpleExecutor.execute(command, execOptions, input);
    }

    if (result.exitCode === 0) {
      return result;
    }

    this.handleNonZeroExitCodes(args, result);
  }

  /**
   * Handles the exit code of the devtools binary
   * Output on debug level, avoiding the default level of info. Error presentation should be done
   * higher in the call stack.
   *
   * @param exitCode exit code from the devtools binary
   * @param stderr stderr from the devtools binary
   * @param args args for logging purposes
   * @throws appropriate Errors
   */
  private handleNonZeroExitCodes(args: string[], { exitCode, stdout, stderr }: ExecResult): never {
    switch (exitCode) {
      case 10: // exit code for DevtoolsErrorModel
        const devtoolsError = safeJsonParse(stderr) as DevtoolsErrorModel;
        logOutputChannel.debug(`devtools exit(${exitCode}) '${args.join(' ')}': ${devtoolsError.message}`);
        throw new DevtoolsError(devtoolsError);
      case 11: // exit code for CreditInfoError
        const creditsInfoError = safeJsonParse(stderr) as CreditsInfoErrorModel;
        logOutputChannel.debug(`devtools exit(${exitCode}) '${args.join(' ')}': ${creditsInfoError.message}`);
        throw new CreditsInfoError(
          creditsInfoError.message,
          creditsInfoError['credits-info'],
          creditsInfoError['trace-id']
        );
      case 'ABORT_ERR': // ABORT_ERR is triggered by AbortController usage
        throw new AbortError();

      default:
        const msg = `devtools exit(${exitCode}) '${args.join(' ')}' - stdout: '${stdout}', stderr: '${stderr}'`;
        logOutputChannel.error(msg);
        throw new Error(msg);
    }
  }

  async executeAsJson<T>(opts: BinaryOpts) {
    const output = await this.runBinary(opts);
    return safeJsonParse(output.stdout, { opts }) as T;
  }
}

interface BinaryOpts {
  // args to pass to the binary
  args: string[];

  // ExecOptions (signal, cwd etc...)
  execOptions?: ExecOptions;

  // optional string to send on stdin
  input?: string;

  /*
    optional taskid for the invocation, ensuring only one task with the same id is running.
    see SingleTaskExecutor for details
  */
  taskId?: string;
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

export class CreditsInfoError extends Error {
  constructor(message: string, readonly creditsInfo: CreditsInfo, readonly traceId: string) {
    super(message);
  }
}

export class DevtoolsError extends Error {
  [property: string]: any;
  constructor(devtoolsErrorObj: DevtoolsErrorModel) {
    super(devtoolsErrorObj.message);
    Object.getOwnPropertyNames(devtoolsErrorObj).forEach((propName) => {
      this[propName] = devtoolsErrorObj[propName];
    });
  }
}

export class AbortError extends Error {}

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
};
