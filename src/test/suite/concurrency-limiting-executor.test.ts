import * as assert from 'assert';
import { ExecOptions } from 'child_process';
import { ConcurrencyLimitingExecutor } from '../../concurrency-limiting-executor';
import { Command, ExecResult, Executor, Task } from '../../executor';

class MockExecutor implements Executor {
  executeCalls: Array<{ command: Command | Task; options: ExecOptions; input?: string }> = [];
  executeTaskCalls: Array<() => Promise<any>> = [];
  private pending: Array<{ resolve: (result: any) => void; reject: (error: Error) => void }> = [];

  async execute(command: Command | Task, options: ExecOptions = {}, input?: string): Promise<ExecResult> {
    this.executeCalls.push({ command, options, input });
    return new Promise<ExecResult>((resolve, reject) => this.pending.push({ resolve, reject }));
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    this.executeTaskCalls.push(task as any);
    return new Promise<T>((resolve, reject) => this.pending.push({ resolve, reject }));
  }

  logStats(): void {}

  complete(index: number, result: any = { stdout: '', stderr: '', exitCode: 0, duration: 100 }): void {
    this.pending[index]?.resolve(result);
  }

  fail(index: number, error: Error): void {
    this.pending[index]?.reject(error);
  }

  get totalCalls(): number {
    return this.executeCalls.length + this.executeTaskCalls.length;
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

suite('ConcurrencyLimitingExecutor Test Suite', () => {
  test('Respects maxConcurrency limit', async () => {
    const mock = new MockExecutor();
    const exec = new ConcurrencyLimitingExecutor(mock, 2);

    const p1 = exec.execute({ command: 'test1', args: [] });
    const p2 = exec.execute({ command: 'test2', args: [] });
    const p3 = exec.execute({ command: 'test3', args: [] });
    const p4 = exec.execute({ command: 'test4', args: [] });

    await tick();
    assert.strictEqual(mock.executeCalls.length, 2);

    mock.complete(0);
    await p1;
    await tick();
    assert.strictEqual(mock.executeCalls.length, 3);

    mock.complete(1);
    await p2;
    await tick();
    assert.strictEqual(mock.executeCalls.length, 4);

    mock.complete(2);
    mock.complete(3);
    await Promise.all([p3, p4]);
  });

  test('Executes tasks in FIFO order', async () => {
    const mock = new MockExecutor();
    const exec = new ConcurrencyLimitingExecutor(mock, 1);
    const order: number[] = [];

    const p1 = exec.execute({ command: 'test1', args: [] }).then(() => order.push(1));
    const p2 = exec.execute({ command: 'test2', args: [] }).then(() => order.push(2));
    const p3 = exec.execute({ command: 'test3', args: [] }).then(() => order.push(3));

    await tick();
    mock.complete(0);
    await tick();
    mock.complete(1);
    await tick();
    mock.complete(2);
    await Promise.all([p1, p2, p3]);

    assert.deepStrictEqual(order, [1, 2, 3]);
  });

  test('Handles errors without blocking queue', async () => {
    const mock = new MockExecutor();
    const exec = new ConcurrencyLimitingExecutor(mock, 1);

    const p1 = exec.execute({ command: 'test1', args: [] });
    const p2 = exec.execute({ command: 'test2', args: [] });

    await tick();
    mock.fail(0, new Error('Test error'));

    await assert.rejects(p1, { message: 'Test error' });
    await tick();
    assert.strictEqual(mock.executeCalls.length, 2);

    mock.complete(1);
    await p2;
  });

  test('mixed execute and executeTask respect concurrency', async () => {
    const mock = new MockExecutor();
    const exec = new ConcurrencyLimitingExecutor(mock, 2);

    const p1 = exec.execute({ command: 'test1', args: [] });
    const p2 = exec.executeTask(async () => 'task1');
    const p3 = exec.execute({ command: 'test2', args: [] });
    const p4 = exec.executeTask(async () => 'task2');

    await tick();
    assert.strictEqual(mock.totalCalls, 2);

    mock.complete(0);
    await p1;
    await tick();
    assert.strictEqual(mock.totalCalls, 3);

    mock.complete(1, 'task1');
    await p2;
    await tick();
    assert.strictEqual(mock.totalCalls, 4);

    mock.complete(2);
    mock.complete(3, 'task2');
    await Promise.all([p3, p4]);
  });

  test('returns correct result from execute', async () => {
    const mock = new MockExecutor();
    const exec = new ConcurrencyLimitingExecutor(mock, 2);
    const expected: ExecResult = { stdout: 'test output', stderr: 'test error', exitCode: 42, duration: 1234 };

    const promise = exec.execute({ command: 'test', args: [] });
    await tick();

    mock.complete(0, expected);
    const result = await promise;

    assert.deepStrictEqual(result, expected);
  });
});
