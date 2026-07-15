import * as assert from 'assert';
import { ExecOptions } from 'child_process';
import { createCpuAwareConcurrencyExecutor } from '../../cpu-usage-based-executor';
import { Command, ExecResult, Executor, Task } from '../../executor';
import { MockSetTimeout } from '../mocks/mock-settimeout';
import { MockIsCpuTooBusy } from '../mocks/mock-iscputoobusy';

class MockExecutor implements Executor {
  executeCalls: Array<{ command: Command | Task; options: ExecOptions; input?: string }> = [];
  executeTaskCalls: Array<() => Promise<any>> = [];
  private pending: Array<{ resolve: (result: any) => void; reject: (error: Error) => void }> = [];
  private resolveNextExecute?: () => void;

  async execute(command: Command | Task, options: ExecOptions = {}, input?: string): Promise<ExecResult> {
    this.executeCalls.push({ command, options, input });
    if (this.resolveNextExecute) {
      this.resolveNextExecute();
      this.resolveNextExecute = undefined;
    }
    return new Promise<ExecResult>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    this.executeTaskCalls.push(task as any);
    if (this.resolveNextExecute) {
      this.resolveNextExecute();
      this.resolveNextExecute = undefined;
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  waitForExecuteCount(count: number): Promise<void> {
    if (this.executeCalls.length + this.executeTaskCalls.length >= count) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.resolveNextExecute = resolve;
    });
  }

  waitForNextExecute(): Promise<void> {
    return this.waitForExecuteCount(this.executeCalls.length + this.executeTaskCalls.length + 1);
  }

  logStats(): void {}

  complete(index: number, result: any = { stdout: '', stderr: '', exitCode: 0, duration: 100 }): void {
    this.pending[index]?.resolve(result);
  }

  fail(index: number, error: Error): void {
    this.pending[index]?.reject(error);
  }

  abortAllTasks(): void {}
}

suite('createCpuAwareConcurrencyExecutor Test Suite', () => {
  test('concurrent requests do not redundantly check CPU', async () => {
    const mockCpu = new MockIsCpuTooBusy([true, false, false, false]);
    const mockSetTimeout = new MockSetTimeout();
    const mock = new MockExecutor();
    const exec = createCpuAwareConcurrencyExecutor(
      mock,
      1,
      mockSetTimeout.setTimeout.bind(mockSetTimeout),
      mockCpu.isCpuTooBusy.bind(mockCpu)
    );

    const promise1 = exec.execute({ command: 'test1', args: [] }, {});
    const promise2 = exec.execute({ command: 'test2', args: [] }, {});
    const promise3 = exec.execute({ command: 'test3', args: [] }, {});

    await mockSetTimeout.waitForNextCall();
    assert.strictEqual(mockCpu.calls, 1, 'only first request should check CPU initially');
    assert.strictEqual(mock.executeCalls.length, 0, 'no executions yet while CPU busy');

    mockSetTimeout.runNext();
    await mock.waitForNextExecute();

    assert.strictEqual(mockCpu.calls, 2, 'first request checked CPU twice (busy then free)');
    assert.strictEqual(mock.executeCalls.length, 1, 'first request executing');

    mock.complete(0);
    await mock.waitForNextExecute();

    assert.strictEqual(mockCpu.calls, 3, 'second request now checks CPU');
    assert.strictEqual(mock.executeCalls.length, 2, 'second request executing');

    mock.complete(1);
    await mock.waitForNextExecute();

    assert.strictEqual(mockCpu.calls, 4, 'third request now checks CPU');
    assert.strictEqual(mock.executeCalls.length, 3, 'third request executing');

    mock.complete(2);
    await Promise.all([promise1, promise2, promise3]);
  });
});
