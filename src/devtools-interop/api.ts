import { ExecOptions } from 'child_process';
import { Command, LimitingExecutor, SimpleExecutor } from '../executor';
import { getFileExtension } from '../utils';
import { CodeSmell } from './../review/model';
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
  private simpleExecutor: SimpleExecutor = new SimpleExecutor();
  private limitingExecutor: LimitingExecutor = new LimitingExecutor(this.simpleExecutor);
  private preflightJson?: string;

  constructor(private binaryPath: string, context: ExtensionContext) {
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
  codeHealthRulesTemplate() {
    return this.runBinary(['code-health-rules-template']);
  }

  /**
   * Executes the command for checking code health rule match against file
   */
  async checkRules(rootPath: string, filePath: string) {
    const command: Command = {
      command: this.binaryPath,
      args: ['check-rules', filePath],
      ignoreError: true,
    };
    const { stdout, stderr } = await this.simpleExecutor.execute(command, { cwd: rootPath });
    const err = stderr.trim();
    return { rulesMsg: stdout.trim(), errorMsg: err !== '' ? err : undefined } as CodeHealthRulesResult;
  }

  async deltaForFile(document: TextDocument, inputJsonString: string) {
    return await this.limitingExecutor.execute(
      { command: this.binaryPath, args: ['delta'], taskId: taskId(document), ignoreError: true },
      undefined,
      inputJsonString
    );
  }

  /**
   * Do a new preflight request and update the internal json used by subsequent fnsToRefactor calls
   * @returns
   */
  async preflight() {
    const args = ['refactor', 'preflight'];
    const response = await this.executeAsJson<PreFlightResponse>(args);
    this.preflightJson = JSON.stringify(response);
    return response;
  }

  async fnsToRefactorFromCodeSmells(document: TextDocument, codeSmells: CodeSmell[]) {
    if (codeSmells.length === 0) return [];
    return this.fnsToRefactor(document, ['--code-smells', JSON.stringify(codeSmells)]);
  }

  async fnsToRefactorFromDelta(document: TextDocument, delta: DeltaForFile) {
    return this.fnsToRefactor(document, ['--delta-result', JSON.stringify(delta)]);
  }

  private async fnsToRefactor(document: TextDocument, args: string[]) {
    const arglist = ['refactor', 'fns-to-refactor', '--extension', getFileExtension(document.fileName)].concat(args);
    if (this.preflightJson) {
      arglist.push('--preflight', this.preflightJson);
    }
    const ret = await this.executeAsJson<FnToRefactor[]>(arglist, {}, document.getText());
    ret.forEach((fn) => (fn.vscodeRange = vscodeRange(fn.range)!));
    return ret;
  }

  async post(request: RefactoringRequest) {
    const { fnToRefactor, skipCache, signal } = request;

    const args = ['refactor', 'post', '--fn-to-refactor', JSON.stringify(fnToRefactor)];
    if (skipCache) args.push('--skip-cache');

    const session = CsExtensionState.stateProperties.session;
    if (session && isCodeSceneSession(session)) {
      args.push('--token', session.accessToken);
    }

    const stdout = await this.runBinary(args, { signal });
    return JSON.parse(stdout) as RefactorResponse;
  }

  postTelemetry(event: TelemetryEvent) {
    const jsonEvent = JSON.stringify(event);
    return this.runBinary(['telemetry', '--event', jsonEvent]);
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
