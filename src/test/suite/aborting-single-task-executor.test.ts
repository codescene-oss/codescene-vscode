import * as assert from 'assert';
import { ExecOptions } from 'child_process';
import { AbortingSingleTaskExecutor } from '../../aborting-single-task-executor';
import { Command, ExecResult, Executor, Task } from '../../executor';

class MockExecutor implements Executor {
  executeCalls: Task[] = [];
  private pending: Array<{ resolve: (result: ExecResult) => void; reject: (error: Error) => void }> = [];

  async execute(command: Task, options: ExecOptions = {}): Promise<ExecResult> {
    this.executeCalls.push(command);
    return new Promise<ExecResult>((resolve, reject) => {
      const entry = { resolve, reject };
      this.pending.push(entry);
      const signal = options.signal;
      if (signal) {
        if (signal.aborted) {
          reject(new Error('Aborted'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new Error('Aborted'));
        }, { once: true });
      }
    });
  }

  async executeTask<T>(task: () => Promise<T>): Promise<T> {
    return task();
  }

  logStats(): void {}

  complete(index: number, result: ExecResult = { stdout: '', stderr: '', exitCode: 0, duration: 1 }): void {
    this.pending[index]?.resolve(result);
  }

  abortAllTasks(): void {
    this.pending.forEach((p) => p.reject(new Error('Aborted')));
    this.pending = [];
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

suite('AbortingSingleTaskExecutor Test Suite', () => {
  test('aborts previous task with same taskId before starting new one', async function () {
    this.timeout(5000);
    const mock = new MockExecutor();
    const exec = new AbortingSingleTaskExecutor(mock);

    const first = exec.execute({ command: 'git', args: ['status'], taskId: 'git' });
    await tick();
    const second = exec.execute({ command: 'git', args: ['diff'], taskId: 'git' });
    await tick();

    await assert.rejects(first);
    mock.complete(mock.executeCalls.length - 1);
    await second;
    assert.strictEqual(mock.executeCalls.length, 2);
  });

  test('abort cancels a running task by id', async () => {
    const mock = new MockExecutor();
    const exec = new AbortingSingleTaskExecutor(mock);

    const running = exec.execute({ command: 'git', args: ['status'], taskId: 'git-status' });
    await tick();
    exec.abort('git-status');

    await assert.rejects(running, { message: 'Aborted' });
  });

  test('abortAllTasks cancels all running tasks', async () => {
    const mock = new MockExecutor();
    const exec = new AbortingSingleTaskExecutor(mock);

    const first = exec.execute({ command: 'git', args: ['status'], taskId: 'a' });
    const second = exec.execute({ command: 'git', args: ['diff'], taskId: 'b' });
    await tick();

    exec.abortAllTasks();

    await assert.rejects(first);
    await assert.rejects(second);
  });
});
