import { ExecOptions } from 'child_process';
import { logOutputChannel } from './log';
import { SimpleExecutor } from './simple-executor';
import { Command, ExecResult, Executor, Task } from './executor';

export class SingleTaskExecutor implements Executor {
  private readonly executor;
  private readonly runningCommands: Map<string, AbortController> = new Map();

  constructor(executor: Executor = new SimpleExecutor()) {
    this.executor = executor;
  }

  async execute(command: Task, options: ExecOptions = {}, input?: string) {
    const taskId = command.taskId;

    // Check if running already
    const runningProcess = this.runningCommands.get(taskId);
    if (runningProcess) {
      runningProcess.abort(`[SingleTaskExecutor] Abort current command ${taskId} and re-run`);
    }

    const abortController = new AbortController();
    this.runningCommands.set(taskId, abortController);

    try {
      return await this.executor.execute(command, { ...options, signal: abortController.signal }, input);
    } finally {
      // Remove the abortController from the map.
      // The process has exited, and we don't want to risk calling abort() on
      // a process that has already exited (what if the pid has been reused?)
      if (this.runningCommands.get(taskId) === abortController) {
        this.runningCommands.delete(taskId);
      }
    }
  }

  logStats(): void {
    this.executor.logStats();
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    return this.executor.executeTask(task);
  }

  abort(taskId: string) {
    const abortController = this.runningCommands.get(taskId);
    if (abortController) {
      abortController.abort(`[SingleTaskExecutor] Abort command ${taskId}`);
    }
  }

  abortAllTasks(): void {
    const taskIds = Array.from(this.runningCommands.keys());
    for (const taskId of taskIds) {
      try {
        logOutputChannel.error(`[SingleTaskExecutor] Aborting task ${taskId}`);
        this.abort(taskId);
      } catch (error) {
        logOutputChannel.error(`[SingleTaskExecutor] Error aborting task ${taskId}: ${error}`);
      }
    }
  }
}

