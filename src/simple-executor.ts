import { ChildProcess, execFile, ExecFileException, ExecOptions, spawn } from 'child_process';
import { logOutputChannel } from './log';
import { Command, ExecResult, Executor } from './executor';
import { Stats } from './executor-stats';

const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB

function shouldWriteStdinInput(input: string | undefined, stdin: NodeJS.WritableStream | null): input is string {
  return input !== undefined && input !== null && stdin !== null;
}

export function parseJsonInput(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

const SENSITIVE_KEYS = new Set(['token', 'accessToken', 'Authorization']);

function maybeRedactValue(key: string, value: any): any {
  return SENSITIVE_KEYS.has(key) ? '[REDACTED]' : value;
}

export function objectToArray(obj: any): any[] {
  if (Array.isArray(obj)) {
    return obj;
  }
  if (typeof obj === 'object' && obj !== null) {
    const { 'file-content': _, ...rest } = obj;
    return Object.entries(rest).flatMap(([key, value]) => [`'${key}'`, maybeRedactValue(key, value)]);
  }
  return [];
}

export function mergeJsonIntoArgs(args: string[], input: string): string[] {
  const parsed = parseJsonInput(input);
  if (!parsed || (typeof parsed !== 'object')) {
    return args;
  }
  const arrayToMerge = objectToArray(parsed);
  return [...args, ...arrayToMerge.map((v) => typeof v === 'string' ? v : JSON.stringify(v))];
}

interface RunningProcess {
  /** Tracks spawned processes so abortAllTasks can reject in-flight execute() promises. */
  childProcess: ChildProcess;
  reject: (error: Error) => void;
}

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
  private readonly runningProcesses = new Map<ChildProcess, RunningProcess>();

  logStats(): void {
    this.stats.logStats();
  }

  execute(command: Command, options: ExecOptions & { cwd: string }, input?: string) {
    const mergedArgsForLogging = input ? mergeJsonIntoArgs(command.args, input) : command.args;
    const logName = [command.command, ...mergedArgsForLogging].join(' ');
    const allOptions = { maxBuffer: MAX_BUFFER, ...options };
    this.logCommandStart(command, mergedArgsForLogging, allOptions);

    return new Promise<ExecResult>((resolve, reject) => {
      const start = Date.now();
      let settled = false;

      const childProcess = execFile(command.command, command.args, allOptions, (error, stdout, stderr) => {
        this.handleExecCompletion({
          childProcess,
          command,
          logName,
          allOptions,
          start,
          error,
          stdout,
          stderr,
          resolve,
          reject,
          markSettled: () => {
            settled = true;
          },
          isSettled: () => settled,
        });
      });

      this.trackRunningProcess(childProcess, () => settled, () => {
        settled = true;
      }, reject);

      if (shouldWriteStdinInput(input, childProcess.stdin)) {
        this.writeInput(childProcess, input);
      }

      logOutputChannel.trace(`[pid ${childProcess.pid}] "${logName}" started`);
    });
  }

  private logCommandStart(command: Command, mergedArgsForLogging: string[], allOptions: ExecOptions): void {
    const trimmedArgsForLogging = mergedArgsForLogging.map((arg) => (arg.length > 120 ? arg.slice(0, 120) + '...' : arg));
    const logCommand = [command.command, ...trimmedArgsForLogging].join(' ');
    if (command.command === 'git') {
      logOutputChannel.debug(`Executing: "${logCommand}" with options: ${JSON.stringify(allOptions)}`);
    } else {
      logOutputChannel.info(`Executing: "${logCommand}" with options: ${JSON.stringify(allOptions)}`);
    }
  }

  private handleExecCompletion(params: {
    childProcess: ChildProcess;
    command: Command;
    logName: string;
    allOptions: ExecOptions;
    start: number;
    error: ExecFileException | null;
    stdout: string;
    stderr: string;
    resolve: (result: ExecResult) => void;
    reject: (error: Error) => void;
    markSettled: () => void;
    isSettled: () => boolean;
  }): void {
    const { childProcess, command, logName, allOptions, start, error, stdout, stderr, resolve, reject, markSettled, isSettled } =
      params;
    this.runningProcesses.delete(childProcess);
    if (isSettled()) {
      return;
    }
    markSettled();

    if (!command.ignoreError && error) {
      logOutputChannel.error(
        `[pid ${childProcess?.pid}] "${logName}" failed with error: ${error} and options ${JSON.stringify(allOptions)}`
      );
      reject(error);
      return;
    }

    const end = Date.now();
    logOutputChannel.trace(`[pid ${childProcess?.pid}] "${logName}" took ${end - start} ms (exit ${error?.code || 0})`);
    this.stats.addRun(command, end - start);
    resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: error?.code || 0, duration: end - start });
  }

  private trackRunningProcess(
    childProcess: ChildProcess,
    isSettled: () => boolean,
    markSettled: () => void,
    reject: (error: Error) => void
  ): void {
    this.runningProcesses.set(childProcess, {
      childProcess,
      reject: (error: Error) => {
        if (isSettled()) {
          return;
        }
        markSettled();
        this.runningProcesses.delete(childProcess);
        reject(error);
      },
    });
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    return task();
  }

  abortAllTasks(): void {
    for (const { childProcess, reject } of [...this.runningProcesses.values()]) {
      this.killProcessTree(childProcess);
      reject(new Error('Task aborted'));
    }
    this.runningProcesses.clear();
  }

  private killProcessTree(childProcess: ChildProcess): void {
    const pid = childProcess.pid;
    if (!pid) {
      return;
    }

    // execFile on Windows leaves child processes alive unless the whole tree is killed.
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }

    try {
      childProcess.kill('SIGTERM');
    } catch (error) {
      logOutputChannel.debug(`Failed to kill child process ${pid}: ${error}`);
    }
  }
}

export interface Task extends Command {
  taskId: string;
}
