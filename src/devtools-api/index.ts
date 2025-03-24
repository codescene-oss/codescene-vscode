import { ExecOptions } from 'child_process';
import { Command, LimitingExecutor, SimpleExecutor } from '../executor';
import { CodeSmell } from '../review/model';
import { getFileExtension } from '../utils';
import { CodeHealthRulesResult, DevtoolsError as DevtoolsErrorModel } from './model';
import {
  CreditsInfo,
  CreditsInfoError as CreditsInfoErrorModel,
  FnToRefactor,
  PreFlightResponse,
  RefactorResponse,
} from './refactor-models';

import vscode, { ExtensionContext, TextDocument } from 'vscode';
import { DeltaForFile } from '../code-health-monitor/model';
import { CsExtensionState } from '../cs-extension-state';
import { isCodeSceneSession } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { RefactoringRequest } from '../refactoring/request';
import { vscodeRange } from '../review/utils';
import { TelemetryEvent } from './telemetry-model';

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
   * @param args args for the binary
   * @param options ExecOptions (signal, cwd etc...)
   * @param input optional string to send on stdin
   * @returns stdout of the command
   * @throws Error, DevtoolsError or CreditsInfoError depending on exit code
   */
  private async runBinary(args: string[], options: ExecOptions = {}, input?: string) {
    const command: Command = {
      command: this.binaryPath,
      args,
      ignoreError: true,
    };
    const result = await this.simpleExecutor.execute(command, options, input);
    const { stdout, stderr, exitCode } = result;
    if (exitCode === 0) {
      return stdout.trim();
    }

    switch (exitCode) {
      case 10: // exit code for DevtoolsErrorModel
        const devtoolsError = JSON.parse(stderr) as DevtoolsErrorModel;
        logOutputChannel.error(`Error running '${args.join(' ')}': ${devtoolsError.message}`);
        throw new DevtoolsError(devtoolsError);
      case 11: // exit code for CreditInfoError
        const creditsInfoError = JSON.parse(stderr) as CreditsInfoErrorModel;
        logOutputChannel.error(`Error running '${args.join(' ')}': ${creditsInfoError.message}`);
        throw new CreditsInfoError(creditsInfoError.message, creditsInfoError['credits-info']);

      default:
        logOutputChannel.error(`Error running '${args.join(' ')}': ${stderr}`);
        throw new Error(stderr);
    }
  }

  private async executeAsJson<T>(args: string[], options?: ExecOptions, input?: string) {
    const output = await this.runBinary(args, options, input);
    return JSON.parse(output) as T;
  }

  /**
   * Executes the command for creating a code health rules template.
   */
  static codeHealthRulesTemplate() {
    return this.instance.runBinary(['code-health-rules-template']);
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
    return await DevtoolsAPI.instance.limitingExecutor.execute(
      { command: DevtoolsAPI.instance.binaryPath, args: ['delta'], taskId: taskId(document), ignoreError: true },
      undefined,
      inputJsonString
    );
  }

  /**
   * Do a new preflight request and update the internal json used by subsequent fnsToRefactor calls
   * @returns
   */
  static async preflight() {
    const args = ['refactor', 'preflight'];
    const response = await DevtoolsAPI.instance.executeAsJson<PreFlightResponse>(args);
    DevtoolsAPI.instance.preflightJson = JSON.stringify(response);
    return response;
  }

  static aceEnabled() {
    return DevtoolsAPI.instance.preflightJson !== undefined;
  }

  static disableAce() {
    DevtoolsAPI.instance.preflightJson = undefined;
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
    if (!DevtoolsAPI.instance.preflightJson) return;
    const arglist = [
      'refactor',
      'fns-to-refactor',
      '--extension',
      getFileExtension(document.fileName),
      '--preflight',
      DevtoolsAPI.instance.preflightJson,
    ].concat(args);
    const ret = await DevtoolsAPI.instance.executeAsJson<FnToRefactor[]>(arglist, {}, document.getText());
    ret.forEach((fn) => (fn.vscodeRange = vscodeRange(fn.range)!));
    return ret;
  }

  static async postRefactoring(request: RefactoringRequest) {
    const { fnToRefactor, skipCache, signal } = request;

    const args = ['refactor', 'post', '--fn-to-refactor', JSON.stringify(fnToRefactor)];
    if (skipCache) args.push('--skip-cache');

    const session = CsExtensionState.stateProperties.session;
    if (session && isCodeSceneSession(session)) {
      args.push('--token', session.accessToken);
    }

    const stdout = await DevtoolsAPI.instance.runBinary(args, { signal });
    return JSON.parse(stdout) as RefactorResponse;
  }

  static postTelemetry(event: TelemetryEvent) {
    const jsonEvent = JSON.stringify(event);
    return DevtoolsAPI.instance.runBinary(['telemetry', '--event', jsonEvent]);
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
