import * as assert from 'assert';
import { ExecOptions } from 'child_process';
import { CpuUsageBasedExecutor } from '../../cpu-usage-based-executor';
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

const tick = () => new Promise(resolve => setImmediate(resolve));

suite('CpuUsageBasedExecutor Test Suite', () => {
  [
    { cpuResponses: [false], desc: 'execute [false]', expectedWaits: 0 },
    { cpuResponses: [true, false], desc: 'execute [true, false]', expectedWaits: 1 },
    { cpuResponses: [false, true], desc: 'execute [false, true]', expectedWaits: 0 },
    { cpuResponses: [false, true, false], desc: 'execute [false, true, false]', expectedWaits: 0 },
    { cpuResponses: [true, false, true], desc: 'execute [true, false, true]', expectedWaits: 1 },
    { cpuResponses: [true, true, false], desc: 'execute [true, true, false]', expectedWaits: 2 },
  ].forEach(({ cpuResponses, desc, expectedWaits }) => {
    test(desc, async () => {
      const mockCpu = new MockIsCpuTooBusy(cpuResponses);
      const mockSetTimeout = new MockSetTimeout();
      const mock = new MockExecutor();
      const exec = new CpuUsageBasedExecutor(
        mock,
        mockSetTimeout.setTimeout.bind(mockSetTimeout),
        mockCpu.isCpuTooBusy.bind(mockCpu)
      );

      const promise = exec.execute({ command: 'test', args: [] });

      if (expectedWaits === 0) {
        await mock.waitForNextExecute();
      } else {
        for (let i = 0; i < expectedWaits; i++) {
          await mockSetTimeout.waitForNextCall();
          assert.strictEqual(mock.executeCalls.length, 0);
          assert.strictEqual(mockSetTimeout.calls.length, 1);
          assert.strictEqual(mockSetTimeout.calls[0].ms, 9000);

          mockSetTimeout.runNext();

          if (i === expectedWaits - 1) {
            await mock.waitForNextExecute();
          }
        }
      }

      assert.strictEqual(mockCpu.calls, expectedWaits + 1);
      assert.strictEqual(mockSetTimeout.callCount, 0);
      assert.strictEqual(mock.executeCalls.length, 1);
      mock.complete(0);
      await promise;
    });
  });

  [
    { cpuResponses: [false], desc: 'executeTask [false]', expectedWaits: 0 },
    { cpuResponses: [true, false], desc: 'executeTask [true, false]', expectedWaits: 1 },
    { cpuResponses: [false, true], desc: 'executeTask [false, true]', expectedWaits: 0 },
    { cpuResponses: [false, true, false], desc: 'executeTask [false, true, false]', expectedWaits: 0 },
    { cpuResponses: [true, false, true], desc: 'executeTask [true, false, true]', expectedWaits: 1 },
    { cpuResponses: [true, true, false], desc: 'executeTask [true, true, false]', expectedWaits: 2 },
  ].forEach(({ cpuResponses, desc, expectedWaits }) => {
    test(desc, async () => {
      const mockCpu = new MockIsCpuTooBusy(cpuResponses);
      const mockSetTimeout = new MockSetTimeout();
      const mock = new MockExecutor();
      const exec = new CpuUsageBasedExecutor(
        mock,
        mockSetTimeout.setTimeout.bind(mockSetTimeout),
        mockCpu.isCpuTooBusy.bind(mockCpu)
      );

      const promise = exec.executeTask(async () => 'result');

      if (expectedWaits === 0) {
        await mock.waitForNextExecute();
      } else {
        for (let i = 0; i < expectedWaits; i++) {
          await mockSetTimeout.waitForNextCall();
          assert.strictEqual(mock.executeTaskCalls.length, 0);
          assert.strictEqual(mockSetTimeout.calls.length, 1);
          assert.strictEqual(mockSetTimeout.calls[0].ms, 9000);

          mockSetTimeout.runNext();

          if (i === expectedWaits - 1) {
            await mock.waitForNextExecute();
          }
        }
      }

      assert.strictEqual(mockCpu.calls, expectedWaits + 1);
      assert.strictEqual(mockSetTimeout.callCount, 0);
      assert.strictEqual(mock.executeTaskCalls.length, 1);
      mock.complete(0, 'result');
      const result = await promise;
      assert.strictEqual(result, 'result');
    });
  });

  test('propagates errors from wrapped executor', async () => {
    const mockCpu = new MockIsCpuTooBusy([false]);
    const mockSetTimeout = new MockSetTimeout();
    const mock = new MockExecutor();
    const exec = new CpuUsageBasedExecutor(
      mock,
      mockSetTimeout.setTimeout.bind(mockSetTimeout),
      mockCpu.isCpuTooBusy.bind(mockCpu)
    );

    const promise = exec.execute({ command: 'test', args: [] });
    await mock.waitForNextExecute();

    mock.fail(0, new Error('Test error'));
    await assert.rejects(promise, { message: 'Test error' });
  });

  test('delegates logStats to wrapped executor', () => {
    const mock = new MockExecutor();
    let called = false;
    mock.logStats = () => { called = true; };

    const exec = new CpuUsageBasedExecutor(mock);
    exec.logStats();

    assert.strictEqual(called, true);
  });

  test('delegates abortAllTasks to wrapped executor', () => {
    const mock = new MockExecutor();
    let called = false;
    mock.abortAllTasks = () => { called = true; };

    const exec = new CpuUsageBasedExecutor(mock);
    exec.abortAllTasks();

    assert.strictEqual(called, true);
  });

});
