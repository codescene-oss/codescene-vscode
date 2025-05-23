import { ExecOptions } from 'child_process';
import { CodeSmell, Review } from '../devtools-api/review-model';
import { Command, ExecResult, LimitingExecutor, SimpleExecutor, Task } from '../executor';
import { assertError, getFileExtension, rangeStr, reportError } from '../utils';
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
import { CsExtensionState, CsFeature } from '../cs-extension-state';
import { logOutputChannel } from '../log';
import { RefactoringRequest } from '../refactoring/request';
import { vscodeRange } from '../review/utils';
import { StatsCollector } from '../stats';
import { Delta } from './delta-model';
import { addRefactorableFunctionsToDeltaResult, jsonForScores } from './delta-utils';
import { TelemetryEvent, TelemetryResponse } from './telemetry-model';
import { getBaselineCommit } from '../code-health-monitor/addon';

export class DevtoolsAPI {
  private static instance: DevtoolsAPIImpl;

  static init(binaryPath: string, context: ExtensionContext) {
    DevtoolsAPI.instance = new DevtoolsAPIImpl(binaryPath, context);
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

  private static readonly analysisErrorEmitter = new vscode.EventEmitter<Error>();
  public static readonly onDidAnalysisFail = DevtoolsAPI.analysisErrorEmitter.event;

  private static startAnalysisEvent() {
    DevtoolsAPI.analysesRunning++;
    DevtoolsAPI.analysisStateEmitter.fire({ state: 'running' });
  }

  private static endAnalysisEvent() {
    DevtoolsAPI.analysesRunning--;
    if (DevtoolsAPI.analysesRunning === 0) {
      DevtoolsAPI.analysisStateEmitter.fire({ state: 'idle' });
    }
  }

  private static readonly reviewEmitter = new vscode.EventEmitter<ReviewEvent>();
  public static readonly onDidReviewComplete = DevtoolsAPI.reviewEmitter.event;

  static async reviewContent(document: vscode.TextDocument) {
    const fp = fileParts(document);
    const binaryOpts = {
      args: ['review', '--file-name', fp.fileName],
      taskId: taskId('review', document),
      execOptions: { cwd: fp.documentDirectory },
      input: document.getText(),
    };

    DevtoolsAPI.startAnalysisEvent();
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
      DevtoolsAPI.endAnalysisEvent();
    }
  }

  static async reviewBaseline(document: vscode.TextDocument) {
    const fp = fileParts(document);

    const commitHash = await getBaselineCommit(document.uri);
    if (!commitHash) return;
    const path = `${commitHash}:./${fp.fileName}`;

    const binaryOpts = {
      args: ['review', path],
      taskId: taskId('review-base', document),
      execOptions: { cwd: fp.documentDirectory },
    };

    DevtoolsAPI.startAnalysisEvent();
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
      DevtoolsAPI.endAnalysisEvent();
    }
  }

  private static async review(document: TextDocument, opts: BinaryOpts) {
    const { stdout, duration } = await DevtoolsAPI.instance.runBinary(opts);
    StatsCollector.instance.recordAnalysis(document.fileName, duration);
    return JSON.parse(stdout) as Review;
  }

  static abortReviews(document: TextDocument) {
    DevtoolsAPI.instance.limitingExecutor.abort(taskId('review', document));
    DevtoolsAPI.instance.limitingExecutor.abort(taskId('review-base', document));
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
    if (!inputJsonString) return;

    DevtoolsAPI.startAnalysisEvent();
    try {
      const result = await DevtoolsAPI.instance.runBinary({
        args: ['delta'],
        input: inputJsonString,
        taskId: taskId('delta', document),
      });
      let deltaResult;
      if (result.stdout !== '') {
        // stdout === '' means there were no changes detected - return undefined to indicate this
        deltaResult = JSON.parse(result.stdout) as Delta;
        await addRefactorableFunctionsToDeltaResult(document, deltaResult);
      }
      DevtoolsAPI.deltaAnalysisEmitter.fire({ document, result: deltaResult });
      return deltaResult;
    } catch (e) {
      if (!(e instanceof AbortError)) {
        DevtoolsAPI.analysisErrorEmitter.fire(assertError(e));
        throw e;
      }
    } finally {
      DevtoolsAPI.endAnalysisEvent();
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
    return ret;
  }

  private static readonly refactoringRequestEmitter = new vscode.EventEmitter<AceRequestEvent>();
  public static readonly onDidRefactoringRequest = DevtoolsAPI.refactoringRequestEmitter.event;
  private static readonly refactoringErrorEmitter = new vscode.EventEmitter<Error>();
  public static readonly onDidRefactoringFail = DevtoolsAPI.refactoringErrorEmitter.event;

  /**
   * Posts a refactoring using devtools binary
   *
   * Fires onDidRefactoringRequest and ondidRefactoringFail events
   *
   * @param request refactoring request
   * @returns refactoring response
   */
  static async postRefactoring(request: RefactoringRequest) {
    const { document, fnToRefactor, skipCache, signal } = request;

    DevtoolsAPI.refactoringRequestEmitter.fire({ document, request, type: 'start' });
    try {
      const args = ['refactor', 'post', '--fn-to-refactor', JSON.stringify(fnToRefactor)];
      if (skipCache) args.push('--skip-cache');

      const session = CsExtensionState.stateProperties.session;
      if (session && isCodeSceneSession(session)) {
        args.push('--token', session.accessToken);
      }

      logOutputChannel.debug(
        `Refactor requested for ${logIdString(fnToRefactor)}${skipCache === true ? ' (retry)' : ''}`
      );
      const response = await DevtoolsAPI.instance.executeAsJson<RefactorResponse>({ args, execOptions: { signal } });
      logOutputChannel.debug(
        `Refactor request done ${logIdString(fnToRefactor, response['trace-id'])}${
          skipCache === true ? ' (retry)' : ''
        }`
      );
      return response;
    } catch (e) {
      reportError({ context: 'Refactoring error', e, consoleOnly: true });
      if (!(e instanceof AbortError)) {
        DevtoolsAPI.refactoringErrorEmitter.fire(assertError(e));
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
}

class DevtoolsAPIImpl {
  public simpleExecutor: SimpleExecutor = new SimpleExecutor();
  public limitingExecutor: LimitingExecutor = new LimitingExecutor(this.simpleExecutor);
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
      result = await this.limitingExecutor.execute(task, execOptions, input);
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
        const devtoolsError = JSON.parse(stderr) as DevtoolsErrorModel;
        logOutputChannel.debug(`devtools exit(${exitCode}) '${args.join(' ')}': ${devtoolsError.message}`);
        throw new DevtoolsError(devtoolsError);
      case 11: // exit code for CreditInfoError
        const creditsInfoError = JSON.parse(stderr) as CreditsInfoErrorModel;
        logOutputChannel.debug(`devtools exit(${exitCode}) '${args.join(' ')}': ${creditsInfoError.message}`);
        throw new CreditsInfoError(
          creditsInfoError.message,
          creditsInfoError['credits-info'],
          creditsInfoError['trace-id']
        );
      case 'ABORT_ERR':
        throw new AbortError();

      default:
        const msg = `devtools exit(${exitCode}) '${args.join(' ')}' - stdout: '${stdout}', stderr: '${stderr}'`;
        logOutputChannel.error(msg);
        throw new Error(msg);
    }
  }

  async executeAsJson<T>(opts: BinaryOpts) {
    const output = await this.runBinary(opts);
    return JSON.parse(output.stdout) as T;
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
  see LimitingExecutor for details
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

function isCodeSceneSession(x: vscode.AuthenticationSession): x is CodeSceneAuthenticationSession {
  return (<CodeSceneAuthenticationSession>x).url !== undefined;
}

function logIdString(fnToRefactor: FnToRefactor, traceId?: string) {
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
};

export type ReviewEvent = {
  document: vscode.TextDocument;
  result?: Review;
};

export type DeltaAnalysisEvent = {
  document: vscode.TextDocument;
  result?: Delta;
};
