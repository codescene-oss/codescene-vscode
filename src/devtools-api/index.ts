import { ExecOptions } from 'child_process';
import { Command, ExecResult, LimitingExecutor, SimpleExecutor, Task } from '../executor';
import { CodeSmell } from '../review/model';
import { assertError, getFileExtension, reportError } from '../utils';
import { AceRequestEvent, CodeHealthRulesResult, DevtoolsError as DevtoolsErrorModel } from './model';
import {
  CreditsInfo,
  CreditsInfoError as CreditsInfoErrorModel,
  FnToRefactor,
  PreFlightResponse,
  RefactorResponse,
} from './refactor-models';

import vscode, { ExtensionContext, TextDocument } from 'vscode';
import { DeltaForFile } from '../code-health-monitor/model';
import { CsExtensionState, CsFeature } from '../cs-extension-state';
import { isCodeSceneSession } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { RefactoringRequest } from '../refactoring/request';
import { vscodeRange } from '../review/utils';
import { TelemetryEvent } from './telemetry-model';

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

export class DevtoolsAPI {
  private static instance: DevtoolsAPI;

  public simpleExecutor: SimpleExecutor = new SimpleExecutor();
  public limitingExecutor: LimitingExecutor = new LimitingExecutor(this.simpleExecutor);
  public preflightJson?: string;

  static init(binaryPath: string, context: ExtensionContext) {
    DevtoolsAPI.instance = new DevtoolsAPI(binaryPath, context);
  }

  private constructor(public binaryPath: string, context: ExtensionContext) {
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
  private async runBinary(opts: BinaryOpts) {
    const { args, execOptions: options, input, taskId } = opts;

    let result: ExecResult;
    if (taskId) {
      const task: Task = {
        command: this.binaryPath,
        args,
        taskId,
        ignoreError: true,
      };
      result = await this.limitingExecutor.execute(task, options, input);
    } else {
      const command: Command = {
        command: this.binaryPath,
        args,
        ignoreError: true,
      };
      result = await this.simpleExecutor.execute(command, options, input);
    }
    const { stdout, stderr, exitCode } = result;
    if (exitCode === 0) {
      return stdout.trim();
    }

    this.handleExitCode(exitCode, stderr, args);
  }

  /**
   * Handles the exit code of the devtools binary
   *
   * @param exitCode exit code from the devtools binary
   * @param stderr stderr from the devtools binary
   * @param args args for logging purposes
   * @throws appropriate Errors
   */
  private handleExitCode(exitCode: number | string, stderr: string, args: string[]): never {
    switch (exitCode) {
      case 10: // exit code for DevtoolsErrorModel
        const devtoolsError = JSON.parse(stderr) as DevtoolsErrorModel;
        logOutputChannel.error(`devtools exit(${exitCode}) '${args.join(' ')}': ${devtoolsError.message}`);
        throw new DevtoolsError(devtoolsError);
      case 11: // exit code for CreditInfoError
        const creditsInfoError = JSON.parse(stderr) as CreditsInfoErrorModel;
        logOutputChannel.error(`devtools exit(${exitCode}) '${args.join(' ')}': ${creditsInfoError.message}`);
        throw new CreditsInfoError(creditsInfoError.message, creditsInfoError['credits-info']);
      case 'ABORT_ERR':
        throw new AbortError();

      default:
        logOutputChannel.error(`devtools exit(${exitCode}) '${args.join(' ')}': ${stderr}`);
        throw new Error(stderr);
    }
  }

  private async executeAsJson<T>(opts: BinaryOpts) {
    const output = await this.runBinary(opts);
    return JSON.parse(output) as T;
  }

  /**
   * Executes the command for creating a code health rules template.
   */
  static codeHealthRulesTemplate() {
    return this.instance.runBinary({ args: ['code-health-rules-template'] });
  }

  /**
   * Executes the command for checking code health rule match against file
   */
  static async checkRules(rootPath: string, filePath: string) {
    // TODO - make this use the runBinary function instead!
    const command: Command = {
      command: DevtoolsAPI.instance.binaryPath,
      args: ['check-rules', filePath],
      ignoreError: true,
    };
    const { stdout, stderr } = await DevtoolsAPI.instance.simpleExecutor.execute(command, { cwd: rootPath });
    const err = stderr.trim();
    return { rulesMsg: stdout.trim(), errorMsg: err !== '' ? err : undefined } as CodeHealthRulesResult;
  }

  static async deltaForFile(document: TextDocument, inputJsonString: string) {
    return this.instance.runBinary({
      args: ['delta'],
      input: inputJsonString,
      taskId: taskId(document),
    });
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
      logOutputChannel.info('ACE enabled!');
      return response;
    } catch (e) {
      const error = assertError(e) || new Error('Unknown error');
      DevtoolsAPI.preflightRequestEmitter.fire({ state: 'error', error });
      reportError('Unable to enable refactoring capabilities', error);
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

  static async fnsToRefactorFromDelta(document: TextDocument, delta: DeltaForFile) {
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
      DevtoolsAPI.instance.preflightJson!, // aceEnabled implies preflightJson is defined
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

      const stdout = await DevtoolsAPI.instance.runBinary({ args, execOptions: { signal } });
      return JSON.parse(stdout) as RefactorResponse;
    } catch (e) {
      const error = assertError(e) || new Error('Unknown refactoring error');
      DevtoolsAPI.refactoringErrorEmitter.fire(error);
      throw error;
    } finally {
      DevtoolsAPI.refactoringRequestEmitter.fire({ document, request, type: 'end' });
    }
  }

  static postTelemetry(event: TelemetryEvent) {
    const jsonEvent = JSON.stringify(event);
    return DevtoolsAPI.instance.runBinary({ args: ['telemetry', '--event', jsonEvent] });
  }
}

function taskId(document: TextDocument) {
  return `${document.fileName} v${document.version}`;
}

export class CreditsInfoError extends Error {
  constructor(message: string, readonly creditsInfo: CreditsInfo) {
    super(message);
  }
}

export class DevtoolsError extends Error {
  constructor(readonly error: DevtoolsErrorModel) {
    super(error.message);
  }
}

export class AbortError extends Error {}
