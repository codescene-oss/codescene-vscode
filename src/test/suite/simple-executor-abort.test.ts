import * as assert from 'assert';
import { SimpleExecutor } from '../../simple-executor';

suite('SimpleExecutor abortAllTasks Test Suite', () => {
  test('aborts a running command', async function () {
    this.timeout(10000);
    const executor = new SimpleExecutor();
    const command = process.platform === 'win32'
      ? { command: 'ping', args: ['127.0.0.1', '-n', '30'], ignoreError: true, taskId: 'test-abort' }
      : { command: 'sleep', args: ['30'], ignoreError: true, taskId: 'test-abort' };

    const runPromise = executor.execute(command, { cwd: process.cwd() });
    await new Promise((resolve) => setTimeout(resolve, 200));
    executor.abortAllTasks();

    await assert.rejects(runPromise, { message: 'Task aborted' });
  });
});
