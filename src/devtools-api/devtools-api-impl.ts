import { ExecOptions } from 'child_process';
import { Command, ExecResult, Task } from '../executor';
import { SimpleExecutor } from '../simple-executor';
import { ConcurrencyLimitingExecutor } from '../concurrency-limiting-executor';
import { QueuedSingleTaskExecutor } from '../queued-single-task-executor';
import { safeJsonParse, networkErrors } from '../utils';
import { DevtoolsError as DevtoolsErrorModel } from './model';

import vscode, { ExtensionContext } from 'vscode';
import { logOutputChannel } from '../log';
import { DevtoolsError } from './devtools-error';
import { AbortError } from './abort-error';
import { createCpuAwareConcurrencyExecutor, IsCpuTooBusyFn } from '../cpu-usage-based-executor';

const TELEMETRY_POST_TASK_ID = 'telemetry-post';
const TELEMETRY_DEVICE_ID_TASK_ID = 'telemetry-device-id';
const QUEUED_SINGLE_EXECUTOR_TASK_IDS = [TELEMETRY_POST_TASK_ID, TELEMETRY_DEVICE_ID_TASK_ID];
const DELTA_TASK_ID_PREFIX = 'delta';

function presentCommand(obj: Task | Command, cwd: string): string {
  const trimmedObj = {
    ...obj,
    cwd: cwd,
    args: obj.args.map((arg) => (arg.length > 120 ? arg.slice(0, 120) + '...' : arg)),
  };
  return JSON.stringify(trimmedObj);
}

export class DevtoolsAPIImpl {
  public simpleExecutor: SimpleExecutor = new SimpleExecutor();
  public queuedSingleTaskExecutor: QueuedSingleTaskExecutor = new QueuedSingleTaskExecutor(this.simpleExecutor);
  public concurrencyLimitingExecutor: ConcurrencyLimitingExecutor = new ConcurrencyLimitingExecutor(
    this.simpleExecutor
  );
  public concurrencyLimitingExecutorForDelta: ConcurrencyLimitingExecutor = new ConcurrencyLimitingExecutor(
    this.simpleExecutor
  );
  public networkError: boolean = false;

  constructor(public binaryPath: string, context: ExtensionContext, isCpuTooBusyFn?: IsCpuTooBusyFn) {
    this.concurrencyLimitingExecutor = createCpuAwareConcurrencyExecutor(this.simpleExecutor, undefined, undefined, isCpuTooBusyFn);
    this.concurrencyLimitingExecutorForDelta = createCpuAwareConcurrencyExecutor(this.simpleExecutor, undefined, undefined, isCpuTooBusyFn);
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
   * @throws Error or DevtoolsError depending on exit code
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
      logOutputChannel.info("Running task: " + presentCommand(task, execOptions.cwd));

      // QUEUED_SINGLE_EXECUTOR_TASK_IDS uses queuedSingleTaskExecutor which queues tasks instead of aborting them.

      // DELTA_TASK_ID_PREFIX uses concurrencyLimitingExecutorForDelta. By having a separate ConcurrencyLimitingExecutor for it,
      // we ensure UI responsiveness in the Monitor even if the main concurrencyLimitingExecutor was fully utilized.
      if (taskId.startsWith(DELTA_TASK_ID_PREFIX)) {
        result = await this.concurrencyLimitingExecutorForDelta.execute(task, execOptions, input);
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
      logOutputChannel.info("Running command: " + presentCommand(command, execOptions.cwd));
      result = await this.simpleExecutor.execute(command, execOptions, input);
    }

    if (result.exitCode === 0) {
      return result;
    }

    this.handleNonZeroExitCodes(args, result, execOptions.cwd);
  }

  private fullErrorMessage(
    exitCode: number | string,
    args: string[],
    errorMessage: string,
    stdout: string,
    stderr: string,
    cwd: string
  ): string {
    // IMPORTANT: keep stderr as part of the `msg`, so that network errors can be detected as such.
    const message = `devtools exit(${exitCode}) '${args.join(' ')}': ${errorMessage} - stdout: '${stdout}', stderr: '${stderr}', cwd: '${cwd}'`;
    logOutputChannel.debug(message);
    return message;
  }

  /**
   * Handles the exit code of the devtools binary
   * Output on debug level, avoiding the default level of info. Error presentation should be done
   * higher in the call stack.
   *
   * @param exitCode exit code from the devtools binary
   * @param stderr stderr from the devtools binary
   * @param args args for logging purposes
   * @param cwd current working directory
   * @throws appropriate Errors
   */
  private handleNonZeroExitCodes(args: string[], { exitCode, stdout, stderr }: ExecResult, cwd: string): never {
    switch (exitCode) {
      case 10: // exit code for DevtoolsErrorModel
        const devtoolsError = safeJsonParse(stdout) as DevtoolsErrorModel;
        devtoolsError.message = devtoolsError.message?.trim() || "DevtoolsError";
        devtoolsError.message = this.fullErrorMessage(exitCode, args, devtoolsError.message, stdout, stderr, cwd);
        throw new DevtoolsError(devtoolsError);
      case 'ABORT_ERR': // ABORT_ERR is triggered by AbortController usage
        const abortError = new AbortError();
        abortError.name = "AbortError";
        abortError.message = "AbortError";
        (abortError as any).code = exitCode;
        abortError.message = this.fullErrorMessage(exitCode, args, abortError.message, stdout, stderr, cwd);
        throw abortError;

      default:
        const msg = this.fullErrorMessage(exitCode, args, '', stdout, stderr, cwd);
        if (Object.values(networkErrors).some(errMsg => msg.includes(errMsg))) {
          this.networkError = true;
        }
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
  execOptions: ExecOptions & { cwd: string };

  // optional string to send on stdin
  input?: string;

  /*
    optional taskid for the invocation, ensuring only one task with the same id is running.
    see QueuedSingleTaskExecutor for details
  */
  taskId?: string;
}
