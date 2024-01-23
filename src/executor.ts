import { ChildProcess, ExecOptions, execFile } from 'child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface Command {
  command: string;
  args: string[];
  /** Don't reject the promise on error */
  ignoreError?: boolean;
}

export interface Executor {
  execute(command: Command, options: ExecOptions, input?: string): Promise<ExecResult>;
}

/**
 * Executes a process and returns its output.
 *
 * Optionally, it can also write to the process' stdin.
 */
export class SimpleExecutor implements Executor {
  private writeInput(childProcess: ChildProcess, input: string) {
    if (childProcess.stdin) {
      childProcess.stdin.write(input, () => {
        if (childProcess.stdin) {
          childProcess.stdin.end();
        }
      });
    } else {
      throw Error(`error: cannot write to stdin of the ${childProcess.spawnfile} process. Unable to execute?`);
    }
  }

  execute(command: Command, options: ExecOptions = {}, input?: string) {
    const logName = [command.command, ...command.args].join(' ');

    const completedPromise = new Promise<ExecResult>((resolve, reject) => {
      const start = Date.now();
      const childProcess = execFile(command.command, command.args, options, (error, stdout, stderr) => {
        if (!command.ignoreError && error) {
          console.log(`CodeScene: "${logName}" [pid ${childProcess.pid}] failed with error: ${error}`);
          reject(error);
          return;
        }
        const end = Date.now();
        console.log(`CodeScene: "${logName}" [pid ${childProcess.pid}] took ${end - start} milliseconds`);
        resolve({ stdout, stderr, exitCode: error?.code || 0, duration: end - start });
      });

      if (input && childProcess.stdin) {
        this.writeInput(childProcess, input);
      }

      console.log(`CodeScene: "${logName}" [pid ${childProcess.pid}] started`);
    });

    return completedPromise;
  }
}


export interface Task extends Command {
  taskId: string;
}

/**
 * An executioner that only allows one execution per "task" at a time.
 *
 * If a task is already running, it will be terminated and its promise will be rejected.
 */
export class LimitingExecutor implements Executor {
  private readonly executor;
  private readonly runningCommands: Map<string, AbortController> = new Map();

  constructor(executor: Executor = new SimpleExecutor()) {
    this.executor = executor;
  }

  execute(command: Task, options: ExecOptions = {}, input?: string) {
    const taskId = command.taskId;

    // Check if running already
    const runningProcess = this.runningCommands.get(taskId);
    if (runningProcess) {
      runningProcess.abort();
    }

    const abortController = new AbortController();
    this.runningCommands.set(taskId, abortController);

    const completedPromise = this.executor.execute(command, {...options, signal: abortController.signal}, input).finally(() => {
      // Remove the abortController from the map.
      // The process has exited, and we don't want to risk calling abort() on
      // a process that has already exited (what if the pid has been reused?)
      if (this.runningCommands.get(taskId) === abortController) {
        this.runningCommands.delete(taskId);
      }
    });

    return completedPromise;
  }
}
