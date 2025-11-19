import { ChildProcess, execFile, ExecOptions } from 'child_process';
import { logOutputChannel } from './log';
import { Command, ExecResult, Executor } from './executor';
import { isDefined } from './utils';
import { Stats } from './executor-stats';

// eslint-disable-next-line @typescript-eslint/naming-convention
const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB

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

  private stats: Stats = new Stats();

  logStats(): void {
    this.stats.logStats();
  }

  execute(command: Command, options: ExecOptions = {}, input?: string) {
    const logName = [command.command, ...command.args].join(' ');

    return new Promise<ExecResult>((resolve, reject) => {
      const start = Date.now();
      const childProcess = execFile(command.command, command.args, { maxBuffer: MAX_BUFFER, ...options }, (error, stdout, stderr) => {
        if (!command.ignoreError && error) {
          logOutputChannel.error(`[pid ${childProcess?.pid}] "${logName}" failed with error: ${error}`);
          reject(error);
          return;
        }
        const end = Date.now();
        logOutputChannel.trace(
          `[pid ${childProcess?.pid}] "${logName}" took ${end - start} ms (exit ${error?.code || 0})`
        );

        this.stats.addRun(command, end - start);

        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: error?.code || 0, duration: end - start });
      });

      if (isDefined(input) && childProcess.stdin) {
        this.writeInput(childProcess, input);
      }

      logOutputChannel.trace(`[pid ${childProcess.pid}] "${logName}" started`);
    });
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    return task();
  }

  abortAllTasks(): void {}
}

export interface Task extends Command {
  taskId: string;
}
