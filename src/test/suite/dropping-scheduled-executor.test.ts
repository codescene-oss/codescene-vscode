import * as assert from 'assert';
import { DroppingScheduledExecutor } from '../../dropping-scheduled-executor';
import { SimpleExecutor } from '../../simple-executor';

suite('DroppingScheduledExecutor Test Suite', () => {
  test('getIntervalSeconds returns the initial interval', () => {
    const executor = new DroppingScheduledExecutor(new SimpleExecutor(), 9);
    assert.strictEqual(executor.getIntervalSeconds(), 9);
    executor.dispose();
  });

  test('setInterval updates the interval', () => {
    const executor = new DroppingScheduledExecutor(new SimpleExecutor(), 9);
    executor.setInterval(20);
    assert.strictEqual(executor.getIntervalSeconds(), 20);
    executor.dispose();
  });

  test('setInterval can set a smaller interval', () => {
    const executor = new DroppingScheduledExecutor(new SimpleExecutor(), 9);
    executor.setInterval(5);
    assert.strictEqual(executor.getIntervalSeconds(), 5);
    executor.dispose();
  });

  test('setInterval updates running scheduler', async () => {
    const executor = new DroppingScheduledExecutor(new SimpleExecutor(), 1);
    let callCount = 0;

    void executor.executeTask(async () => {
      callCount++;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(callCount, 1);

    executor.setInterval(10);
    assert.strictEqual(executor.getIntervalSeconds(), 10);

    executor.dispose();
  });

  test('runs task periodically and handles period changes without dropping work', async function() {
    this.timeout(15000);

    const executor = new DroppingScheduledExecutor(new SimpleExecutor(), 0.3);
    const executions: number[] = [];
    const startTime = Date.now();

    void executor.executeTask(async () => {
      executions.push(Date.now() - startTime);
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    assert.ok(executions.length >= 3, `Expected at least 3 executions at 300ms interval, got ${executions.length}`);
    const initialCount = executions.length;

    for (let i = 1; i < Math.min(4, executions.length); i++) {
      const spacing = executions[i] - executions[i - 1];
      assert.ok(spacing >= 150 && spacing <= 600, `Execution spacing ${spacing}ms outside expected range 150-600ms`);
    }

    executor.setInterval(1.5);

    await new Promise((resolve) => setTimeout(resolve, 3000));
    const countAfterChange = executions.length;
    assert.ok(countAfterChange > initialCount, `Expected more executions after period change, got ${countAfterChange} (was ${initialCount})`);

    await new Promise((resolve) => setTimeout(resolve, 3000));
    const finalCount = executions.length;

    const newExecutions = finalCount - initialCount;
    assert.ok(newExecutions >= 2 && newExecutions <= 8, `Expected 2-8 new executions at 1500ms interval over 6000ms, got ${newExecutions}`);

    for (let i = initialCount + 1; i < finalCount; i++) {
      const spacing = executions[i] - executions[i - 1];
      assert.ok(spacing >= 800 && spacing <= 2500, `Post-change execution spacing ${spacing}ms outside expected range 800-2500ms`);
    }

    executor.dispose();
  });
});
