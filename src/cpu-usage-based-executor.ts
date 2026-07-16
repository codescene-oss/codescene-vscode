import { ExecOptions } from 'child_process';
import { Command, ExecResult, Executor } from './executor';
import { isCpuTooBusy as defaultIsCpuTooBusy } from './cpu-monitor';
import { ConcurrencyLimitingExecutor } from './concurrency-limiting-executor';
import { logOutputChannel } from './log';

const RETRY_DELAY_MS = 9000;

export type SetTimeoutFn = (callback: (...args: any[]) => void, ms: number) => any;
export type IsCpuTooBusyFn = () => Promise<boolean>;

export class CpuUsageBasedExecutor implements Executor {
  constructor(
    private readonly executor: Executor,
    private readonly setTimeoutFn: SetTimeoutFn = setTimeout,
    private readonly isCpuTooBusyFn: IsCpuTooBusyFn = defaultIsCpuTooBusy
  ) {}

  private async waitForCpu(): Promise<void> {
    while (await this.isCpuTooBusyFn()) {
      logOutputChannel.info(`CPU too busy, waiting ${RETRY_DELAY_MS}ms before retry`);
      await new Promise(resolve => this.setTimeoutFn(resolve, RETRY_DELAY_MS));
    }
  }

  async execute(command: Command, options: ExecOptions = {}, input?: string): Promise<ExecResult> {
    await this.waitForCpu();
    return this.executor.execute(command, options, input);
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    await this.waitForCpu();
    return this.executor.executeTask(task);
  }

  logStats(): void {
    this.executor.logStats();
  }

  abortAllTasks(): void {
    this.executor.abortAllTasks();
  }

  abort(taskId: string): void {
    if ('abort' in this.executor && typeof (this.executor as any).abort === 'function') {
      (this.executor as any).abort(taskId);
    }
  }

  dispose(): void {
    if ('dispose' in this.executor && typeof (this.executor as any).dispose === 'function') {
      (this.executor as any).dispose();
    }
  }
}

export function createCpuAwareConcurrencyExecutor(
  executor: Executor,
  maxConcurrency?: number,
  setTimeoutFn?: SetTimeoutFn,
  isCpuTooBusyFn?: IsCpuTooBusyFn
): ConcurrencyLimitingExecutor {
  return new ConcurrencyLimitingExecutor(
    new CpuUsageBasedExecutor(executor, setTimeoutFn, isCpuTooBusyFn),
    maxConcurrency
  );
}
