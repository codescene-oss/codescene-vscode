import * as assert from 'assert';
import { SimpleExecutor } from '../../simple-executor';

function overridePlatform(value: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return () => Object.defineProperty(process, 'platform', original);
}

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

  test('killProcessTree returns early when the child has no pid', () => {
    const executor = new SimpleExecutor();
    assert.doesNotThrow(() => (executor as any).killProcessTree({ pid: undefined }));
  });

  test('killProcessTree uses taskkill on win32', () => {
    const executor = new SimpleExecutor();
    const restorePlatform = overridePlatform('win32');
    // SimpleExecutor calls spawn via the shared CommonJS child_process module, so stub it there.
    const childProcessModule = require('child_process');
    const originalSpawn = childProcessModule.spawn;
    let captured: { cmd: string; args: string[] } | undefined;
    childProcessModule.spawn = (cmd: string, args: string[]) => {
      captured = { cmd, args };
      return { on: () => {}, unref: () => {} } as any;
    };

    try {
      (executor as any).killProcessTree({ pid: 4321 });
      assert.strictEqual(captured?.cmd, 'taskkill');
      assert.deepStrictEqual(captured?.args, ['/pid', '4321', '/T', '/F']);
    } finally {
      childProcessModule.spawn = originalSpawn;
      restorePlatform();
    }
  });

  test('killProcessTree swallows errors when SIGTERM kill throws (non-win32)', () => {
    const executor = new SimpleExecutor();
    const restorePlatform = overridePlatform('linux');
    try {
      const fakeChild = {
        pid: 12345,
        kill: () => {
          throw new Error('kill failed');
        },
      };
      assert.doesNotThrow(() => (executor as any).killProcessTree(fakeChild));
    } finally {
      restorePlatform();
    }
  });

  test('tracked process reject is suppressed once the task has settled', () => {
    const executor = new SimpleExecutor();
    const fakeChild = { pid: 1 } as any;
    let rejected = false;

    (executor as any).trackRunningProcess(
      fakeChild,
      () => true, // isSettled
      () => {}, // markSettled
      () => {
        rejected = true;
      }
    );

    const entry = (executor as any).runningProcesses.get(fakeChild);
    entry.reject(new Error('should be ignored'));

    assert.strictEqual(rejected, false, 'reject must no-op when the task is already settled');
  });
});
