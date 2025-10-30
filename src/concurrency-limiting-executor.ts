import { ExecOptions } from 'child_process';
import * as os from 'os';
import { Command, ExecResult, Executor, Task } from './executor';

/**
 * An executor that limits the number of concurrent executions based on CPU cores.
 * Tasks will be queued and executed as slots become available.
 */
export class ConcurrencyLimitingExecutor implements Executor {
  private readonly executor: Executor;
  private readonly maxConcurrency: number;
  private runningCount = 0;
  private queue: Array<() => void> = [];

  constructor(executor: Executor, maxConcurrency?: number) {
    this.executor = executor;
    this.maxConcurrency = maxConcurrency ?? Math.max(1, os.cpus().length - 1); // Use <cores - 1> in order to not saturate the user's resources
  }

  async execute(command: Command | Task, options: ExecOptions = {}, input?: string): Promise<ExecResult> {
    await this.acquireSlot();

    try {
      return await this.executor.execute(command, options, input);
    } finally {
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
}
