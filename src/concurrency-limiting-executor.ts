import { ExecOptions } from 'child_process';
import * as os from 'os';
import { Command, ExecResult, Executor, Task } from './executor';
import { logOutputChannel } from './log';

/**
 * An executor that limits the number of concurrent executions based on CPU cores.
 * Tasks will be queued and executed as slots become available.
 */
export class ConcurrencyLimitingExecutor implements Executor {
  private readonly executor: Executor;
  private readonly maxConcurrency: number;
  private runningCount = 0;
  private queue: Array<() => void> = [];
  private readonly runningCommands: Map<Command | Task, AbortController> = new Map();

  constructor(executor: Executor, maxConcurrency?: number) {
    this.executor = executor;

    // Temporarily disabled - might contribute to ERR_CHILD_PROCESS_STDIO_MAXBUFFER errors
    // this.maxConcurrency = maxConcurrency ?? Math.max(1, os.cpus().length - 1); // Use <cores - 1> in order to not saturate the user's resources
    this.maxConcurrency = 1;
  }

  async execute(command: Command | Task, options: ExecOptions = {}, input?: string): Promise<ExecResult> {
    await this.acquireSlot();

    const abortController = new AbortController();
    this.runningCommands.set(command, abortController);

    try {
      return await this.executor.execute(command, { ...options, signal: abortController.signal }, input);
    } finally {
      this.runningCommands.delete(command);
      this.releaseSlot();
    }
  }

  /**
   * Executes an arbitrary async function with concurrency limiting.
   * Use this to wrap operations that should be limited by system resources.
   */
  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireSlot();

    try {
      return await this.executor.executeTask(task);
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.runningCount < this.maxConcurrency) {
      this.runningCount++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private releaseSlot(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.runningCount--;
    }
  }

  logStats(): void {
    this.executor.logStats();
  }

  abort(taskId: string) {
    if ('abort' in this.executor && typeof (this.executor as any).abort === 'function') {
      (this.executor as any).abort(taskId);
    }
  }

  abortAllTasks(): void {
    const commands = Array.from(this.runningCommands.entries());
    if (commands.length > 0) {
      logOutputChannel.error(`[ConcurrencyLimitingExecutor] Aborting ${commands.length} running command(s)`);
    }
    for (const [command, abortController] of commands) {
      try {
        const commandStr = 'command' in command ? `${command.command} ${command.args.join(' ')}` : 'unknown';
        logOutputChannel.error(`[ConcurrencyLimitingExecutor] Aborting command: ${commandStr}`);
        abortController.abort('[ConcurrencyLimitingExecutor] Abort all tasks');
      } catch (error) {
        logOutputChannel.error(`[ConcurrencyLimitingExecutor] Error aborting command: ${error}`);
      }
    }
  }

  dispose(): void {
    this.abortAllTasks();
  }
}
