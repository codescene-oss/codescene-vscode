import { ChildProcess, execFile, ExecOptions } from 'child_process';
import { logOutputChannel } from './log';
import { Command, ExecResult, Executor } from './executor';
import { isDefined } from './utils';
import { Stats } from './executor-stats';

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

  execute(command: Command, options: ExecOptions & { cwd: string }, input?: string) {
    const logName = [command.command, ...command.args].join(' ');
    const trimmedArgs = command.args.map((arg) => (arg.length > 120 ? arg.slice(0, 120) + '...' : arg));
    const logCommand = [command.command, ...trimmedArgs].join(' ');
    const allOptions = { maxBuffer: MAX_BUFFER, ...options };

    if (command.command === 'git') { // These can be frequently executed, so demote their log level
      logOutputChannel.debug(`Executing: "${logCommand}" with options: ${JSON.stringify(allOptions)}`);
    } else {
      logOutputChannel.info(`Executing: "${logCommand}" with options: ${JSON.stringify(allOptions)}`);
    }

    return new Promise<ExecResult>((resolve, reject) => {
      const start = Date.now();

      const childProcess = execFile(command.command, command.args, allOptions, (error, stdout, stderr) => {
        if (!command.ignoreError && error) {
          logOutputChannel.error(`[pid ${childProcess?.pid}] "${logName}" failed with error: ${error} and options ${JSON.stringify(allOptions)}`);
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
