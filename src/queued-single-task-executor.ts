import { ExecOptions } from 'child_process';
import { SimpleExecutor } from './simple-executor';
import { Executor, Task, ExecResult } from './executor';

interface QueuedTask {
  command: Task;
  options: ExecOptions;
  input?: string;
  resolve: (value: ExecResult) => void;
  reject: (error: any) => void;
}

export class QueuedSingleTaskExecutor implements Executor {
  private readonly executor;
  private readonly taskQueues: Map<string, QueuedTask[]> = new Map();
  private readonly runningTasks: Set<string> = new Set();

  constructor(executor: Executor = new SimpleExecutor()) {
    this.executor = executor;
  }

  async execute(command: Task, options: ExecOptions = {}, input?: string): Promise<ExecResult> {
    const taskId = command.taskId;

    return new Promise<ExecResult>((resolve, reject) => {
      const queuedTask: QueuedTask = { command, options, input, resolve, reject };

      if (!this.taskQueues.has(taskId)) {
        this.taskQueues.set(taskId, []);
      }

      this.taskQueues.get(taskId)!.push(queuedTask);

      if (!this.runningTasks.has(taskId)) {
        void this.processNextTask(taskId);
      }
    });
  }

  private async processNextTask(taskId: string): Promise<void> {
    const queue = this.taskQueues.get(taskId);
    if (!queue || queue.length === 0) {
      this.runningTasks.delete(taskId);
      return;
    }

    this.runningTasks.add(taskId);
    const queuedTask = queue.shift()!;

    try {
      const result = await this.executor.execute(queuedTask.command, queuedTask.options, queuedTask.input);
      queuedTask.resolve(result);
    } catch (error) {
      queuedTask.reject(error);
    } finally {
      void this.processNextTask(taskId).catch(() => {});
    }
  }

  logStats(): void {
    this.executor.logStats();
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    return this.executor.executeTask(task);
  }

  abortAllTasks(): void {
    this.executor.abortAllTasks();

    // Reject all pending tasks to prevent callers from hanging
    for (const queue of this.taskQueues.values()) {
      for (const queuedTask of queue) {
        queuedTask.reject(new Error('Task aborted'));
      }
    }

    this.taskQueues.clear();
    this.runningTasks.clear();
  }
}
