import * as assert from 'assert';
import { ExecOptions } from 'child_process';
import { QueuedSingleTaskExecutor } from '../../queued-single-task-executor';
import { Command, ExecResult, Executor, Task } from '../../executor';

class MockExecutor implements Executor {
  executeCalls: Array<{ command: Command | Task; options: ExecOptions; input?: string }> = [];
  executeTaskCalls: Array<() => Promise<any>> = [];
  private pending: Array<{ resolve: (result: any) => void; reject: (error: Error) => void }> = [];

  async execute(command: Command | Task, options: ExecOptions = {}, input?: string): Promise<ExecResult> {
    this.executeCalls.push({ command, options, input });
    return new Promise<ExecResult>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          reject(new Error('Aborted'));
        });
      }
    });
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    this.executeTaskCalls.push(task as any);
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
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

  abortAllTasks(): void {
    this.pending.forEach((p) => p.reject(new Error('Aborted')));
    this.pending = [];
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

suite('QueuedSingleTaskExecutor Test Suite', () => {
  test('Executes single task immediately', async () => {
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);

    const p1 = exec.execute({ command: 'test1', args: [], taskId: 'task1' });

    await tick();
    assert.strictEqual(mock.executeCalls.length, 1);

    mock.complete(0);
    await p1;
  });

  test('Queues tasks with same taskId', async () => {
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);

    const p1 = exec.execute({ command: 'test1', args: [], taskId: 'task1' });
    const p2 = exec.execute({ command: 'test2', args: [], taskId: 'task1' });
    const p3 = exec.execute({ command: 'test3', args: [], taskId: 'task1' });

    await tick();
    // Only the first task should execute immediately
    assert.strictEqual(mock.executeCalls.length, 1);

    mock.complete(0);
    await p1;
    await tick();
    // Second task should now execute
    assert.strictEqual(mock.executeCalls.length, 2);

    mock.complete(1);
    await p2;
    await tick();
    // Third task should now execute
    assert.strictEqual(mock.executeCalls.length, 3);

    mock.complete(2);
    await p3;
  });

  test('Executes tasks in FIFO order', async () => {
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);
    const order: number[] = [];

    const p1 = exec.execute({ command: 'test1', args: [], taskId: 'task1' }).then(() => order.push(1));
    const p2 = exec.execute({ command: 'test2', args: [], taskId: 'task1' }).then(() => order.push(2));
    const p3 = exec.execute({ command: 'test3', args: [], taskId: 'task1' }).then(() => order.push(3));

    await tick();
    mock.complete(0);
    await tick();
    mock.complete(1);
    await tick();
    mock.complete(2);
    await Promise.all([p1, p2, p3]);

    assert.deepStrictEqual(order, [1, 2, 3]);
  });

  test('Different taskIds execute concurrently', async () => {
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);

    const p1 = exec.execute({ command: 'test1', args: [], taskId: 'task1' });
    const p2 = exec.execute({ command: 'test2', args: [], taskId: 'task2' });
    const p3 = exec.execute({ command: 'test3', args: [], taskId: 'task3' });

    await tick();
    // All three should execute immediately since they have different taskIds
    assert.strictEqual(mock.executeCalls.length, 3);

    mock.complete(0);
    mock.complete(1);
    mock.complete(2);
    await Promise.all([p1, p2, p3]);
  });

  test('Handles errors without blocking queue', async () => {
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);

    const p1 = exec.execute({ command: 'test1', args: [], taskId: 'task1' });
    const p2 = exec.execute({ command: 'test2', args: [], taskId: 'task1' });

    await tick();
    mock.fail(0, new Error('Test error'));

    await assert.rejects(p1, { message: 'Test error' });
    await tick();
    // Second task should still execute after first fails
    assert.strictEqual(mock.executeCalls.length, 2);

    mock.complete(1);
    await p2;
  });

  test('Returns correct result from execute', async () => {
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);
    const expected: ExecResult = { stdout: 'test output', stderr: 'test error', exitCode: 42, duration: 1234 };

    const promise = exec.execute({ command: 'test', args: [], taskId: 'task1' });
    await tick();

    mock.complete(0, expected);
    const result = await promise;

    assert.deepStrictEqual(result, expected);
  });

  test('abortAllTasks clears queues and aborts running tasks', async () => {
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);

    const p1 = exec.execute({ command: 'test1', args: [], taskId: 'task1' });
    const p2 = exec.execute({ command: 'test2', args: [], taskId: 'task1' });
    const p3 = exec.execute({ command: 'test3', args: [], taskId: 'task2' });

    await tick();
    // p1 and p3 should be running, p2 should be queued
    assert.strictEqual(mock.executeCalls.length, 2);

    exec.abortAllTasks();

    // The running tasks should be aborted via the underlying executor
    // The queued task (p2) should never execute
    assert.strictEqual(mock.executeCalls.length, 2);
  });

  test('Mixed taskIds with queuing', async () => {
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);

    const p1 = exec.execute({ command: 'test1', args: [], taskId: 'task1' });
    const p2 = exec.execute({ command: 'test2', args: [], taskId: 'task1' }); // queued
    const p3 = exec.execute({ command: 'test3', args: [], taskId: 'task2' });
    const p4 = exec.execute({ command: 'test4', args: [], taskId: 'task2' }); // queued

    await tick();
    // p1 and p3 should execute (one per taskId)
    assert.strictEqual(mock.executeCalls.length, 2);

    mock.complete(0);
    await p1;
    await tick();
    // p2 should now execute
    assert.strictEqual(mock.executeCalls.length, 3);

    mock.complete(1);
    await p3;
    await tick();
    // p4 should now execute
    assert.strictEqual(mock.executeCalls.length, 4);

    mock.complete(2);
    mock.complete(3);
    await Promise.all([p2, p4]);
  });

  test('executeTask delegates to underlying executor', async () => {
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);

    const p = exec.executeTask(async () => 'result');
    await tick();

    assert.strictEqual(mock.executeTaskCalls.length, 1);
    mock.complete(0, 'result');
    const result = await p;

    assert.strictEqual(result, 'result');
  });

  test('logStats delegates to underlying executor', () => {
    let logStatsCalled = false;
    const mock = new MockExecutor();
    mock.logStats = () => { logStatsCalled = true; };
    const exec = new QueuedSingleTaskExecutor(mock);

    exec.logStats();

    assert.strictEqual(logStatsCalled, true);
  });

  test('Runs 5 sequential tasks each taking 500ms', async function() {
    this.timeout(5000); // Set timeout to 5 seconds for this test
    const mock = new MockExecutor();
    const exec = new QueuedSingleTaskExecutor(mock);
    const executionOrder: number[] = [];
    const executionTimes: number[] = [];

    const p1 = exec.execute({ command: 'test1', args: [], taskId: 'task1' }).then(() => {
      executionOrder.push(1);
      executionTimes.push(Date.now());
    });
    const p2 = exec.execute({ command: 'test2', args: [], taskId: 'task1' }).then(() => {
      executionOrder.push(2);
      executionTimes.push(Date.now());
    });
    const p3 = exec.execute({ command: 'test3', args: [], taskId: 'task1' }).then(() => {
      executionOrder.push(3);
      executionTimes.push(Date.now());
    });
    const p4 = exec.execute({ command: 'test4', args: [], taskId: 'task1' }).then(() => {
      executionOrder.push(4);
      executionTimes.push(Date.now());
    });
    const p5 = exec.execute({ command: 'test5', args: [], taskId: 'task1' }).then(() => {
      executionOrder.push(5);
      executionTimes.push(Date.now());
    });

    await tick();
    // First task should start immediately
    assert.strictEqual(mock.executeCalls.length, 1);

    // Simulate 500ms delay and complete first task
    await new Promise(resolve => setTimeout(resolve, 500));
    mock.complete(0);
    await tick();
    assert.strictEqual(mock.executeCalls.length, 2);

    // Complete remaining tasks with 500ms delays
    await new Promise(resolve => setTimeout(resolve, 500));
    mock.complete(1);
    await tick();
    assert.strictEqual(mock.executeCalls.length, 3);

    await new Promise(resolve => setTimeout(resolve, 500));
    mock.complete(2);
    await tick();
    assert.strictEqual(mock.executeCalls.length, 4);

    await new Promise(resolve => setTimeout(resolve, 500));
    mock.complete(3);
    await tick();
    assert.strictEqual(mock.executeCalls.length, 5);

    await new Promise(resolve => setTimeout(resolve, 500));
    mock.complete(4);

    await Promise.all([p1, p2, p3, p4, p5]);

    // Verify all 5 tasks were executed in order
    assert.strictEqual(mock.executeCalls.length, 5);
    assert.deepStrictEqual(executionOrder, [1, 2, 3, 4, 5]);

    // Verify each task ran at least 499ms after the previous one
    for (let i = 1; i < executionTimes.length; i++) {
      const timeDiff = executionTimes[i] - executionTimes[i - 1];
      assert.ok(timeDiff >= 499, `Task ${i + 1} ran ${timeDiff}ms after task ${i}, expected at least 499ms`);
    }
  });
});
