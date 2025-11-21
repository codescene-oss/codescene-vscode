import { ExecOptions } from 'child_process';
import { Command, ExecResult, Executor, Task } from './executor';
import { logOutputChannel } from './log';

/**
 * A scheduled executor that runs a single task at fixed intervals.
 * Only one task can run at a time.
 * If a task is still running when the next interval arrives, the new task is dropped.
 */
export class DroppingScheduledExecutor implements Executor {
  private readonly executor: Executor;
  private readonly intervalMs: number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;
  private scheduledTask: (() => Promise<any>) | null = null;
  private hasStarted = false;
  private initialPromise: Promise<any> | null = null;

  constructor(executor: Executor, intervalSeconds: number) {
    if (intervalSeconds <= 0) {
      throw new Error('Interval must be positive');
    }
    this.executor = executor;
    this.intervalMs = intervalSeconds * 1000;
  }

  async execute(command: Command | Task, options?: ExecOptions, input?: string): Promise<ExecResult> {
    if (this.hasStarted) {
      throw new Error('execute() can only be called once. Task has already been started.');
    }

    this.scheduledTask = async () => {
      return this.executor.execute(command, options || {}, input);
    };

    this.startScheduler();

    return this.initialPromise as Promise<ExecResult>;
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    if (this.hasStarted) {
      throw new Error('executeTask() can only be called once. Task has already been started.');
    }

    this.scheduledTask = async () => {
      return this.executor.executeTask(task);
    };

    this.startScheduler();

    return this.initialPromise as Promise<T>;
  }

  private startScheduler(): void {
    this.hasStarted = true;

    this.initialPromise = this.runScheduledTask();

    this.intervalHandle = setInterval(() => {
      this.runScheduledTask().catch(() => {
        // Already handled
      });
    }, this.intervalMs);
  }

  logStats(): void {
  }

  abortAllTasks(): void {
  }

  private async runScheduledTask(): Promise<any> {
    if (this.isRunning) {
      return;
    }

    if (!this.scheduledTask) {
      logOutputChannel.error('[DroppingScheduledExecutor] No task has been set');
      return;
    }

    this.isRunning = true;

    try {
      return await this.scheduledTask();
    } catch (error) {
      logOutputChannel.error(`[DroppingScheduledExecutor] Task error: ${error}`);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  dispose(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
