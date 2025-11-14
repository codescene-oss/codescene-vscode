import { ExecOptions } from 'child_process';
import { Command, ExecResult, Task } from '../executor';
import { SimpleExecutor } from '../simple-executor';
import { ConcurrencyLimitingExecutor } from '../concurrency-limiting-executor';
import { AbortingSingleTaskExecutor } from '../aborting-single-task-executor';
import { QueuedSingleTaskExecutor } from '../queued-single-task-executor';
import { safeJsonParse, rangeStr } from '../utils';
import { DevtoolsError as DevtoolsErrorModel } from './model';
import {
  CreditsInfoError as CreditsInfoErrorModel,
  FnToRefactor,
  ABORTING_SINGLE_EXECUTOR_TASK_IDS,
  QUEUED_SINGLE_EXECUTOR_TASK_IDS,
  DELTA_TASK_ID_PREFIX,
} from './refactor-models';

import { basename, dirname } from 'path';
import vscode, { ExtensionContext, TextDocument } from 'vscode';
import { CodeSceneAuthenticationSession } from '../auth/auth-provider';
import { getAuthToken } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { logOutputChannel } from '../log';
import { DevtoolsError } from './devtools-error';
import { CreditsInfoError } from './credits-info-error';
import { AbortError } from './abort-error';

function presentCommand(obj: Task | Command): string {
  const trimmedObj = {
    ...obj,
    args: obj.args.map((arg) => (arg.length > 120 ? arg.slice(0, 120) + '...' : arg)),
  };
  return JSON.stringify(trimmedObj);
}

export class DevtoolsAPIImpl {
  public simpleExecutor: SimpleExecutor = new SimpleExecutor();
  public abortingSingleTaskExecutor: AbortingSingleTaskExecutor = new AbortingSingleTaskExecutor(this.simpleExecutor);
  public queuedSingleTaskExecutor: QueuedSingleTaskExecutor = new QueuedSingleTaskExecutor(this.simpleExecutor);
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
      logOutputChannel.info("Running task: " + presentCommand(task));
      // abortingSingleTaskExecutor used to be more broadly used, but now with parallelism and caching, it's better to favor concurrencyLimitingExecutor except for the
      // `refactor` operation (or any other member of ABORTING_SINGLE_EXECUTOR_TASK_IDS) since it represents work that is potentially costly, backend-side.
      // QUEUED_SINGLE_EXECUTOR_TASK_IDS uses queuedSingleTaskExecutor which queues tasks instead of aborting them.
      if (ABORTING_SINGLE_EXECUTOR_TASK_IDS.includes(taskId) || taskId.startsWith(DELTA_TASK_ID_PREFIX)) {
        result = await this.abortingSingleTaskExecutor.execute(task, execOptions, input);
      } else if (QUEUED_SINGLE_EXECUTOR_TASK_IDS.includes(taskId)) {
        result = await this.queuedSingleTaskExecutor.execute(task, execOptions, input);
      } else {
        result = await this.concurrencyLimitingExecutor.execute(task, execOptions, input);
      }
    } else {
      const command: Command = {
        command: this.binaryPath,
        args,
        ignoreError: true,
      };
      logOutputChannel.info("Running command: " + presentCommand(command));
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
        const devtoolsError = safeJsonParse(stdout) as DevtoolsErrorModel;
        logOutputChannel.debug(`devtools exit(${exitCode}) '${args.join(' ')}': ${devtoolsError.message}`);
        throw new DevtoolsError(devtoolsError);
      case 11: // exit code for CreditInfoError
        const creditsInfoError = safeJsonParse(stdout) as CreditsInfoErrorModel;
        logOutputChannel.debug(`devtools exit(${exitCode}) '${args.join(' ')}': ${creditsInfoError.message}`);
        throw new CreditsInfoError(
          creditsInfoError.message,
          creditsInfoError['credits-info'],
          creditsInfoError['trace-id']
        );
      case 'ABORT_ERR': // ABORT_ERR is triggered by AbortController usage
        const abortError = new AbortError();
        (abortError as any).code = exitCode;
        throw abortError;

      default:
        const msg = `devtools exit(${exitCode}) '${args.join(' ')}' - stdout: '${stdout}', stderr: '${stderr}'`;
        logOutputChannel.error(msg);
        const error = new Error(msg);
        (error as any).code = exitCode;
        throw error;
    }
  }

  async executeAsJson<T>(opts: BinaryOpts) {
    const output = await this.runBinary(opts);
    return safeJsonParse(output.stdout, { opts }) as T;
  }
}

export interface BinaryOpts {
  // args to pass to the binary
  args: string[];

  // ExecOptions (signal, cwd etc...)
  execOptions?: ExecOptions;

  // optional string to send on stdin
  input?: string;

  /*
    optional taskid for the invocation, ensuring only one task with the same id is running.
    see AbortingSingleTaskExecutor, QueuedSingleTaskExecutor for details
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
