import * as assert from 'assert';
import { REVIEW_QUEUE_THROTTLE_MS, ReviewQueueProgress } from '../../devtools-api/review-queue-progress';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('ReviewQueueProgress', () => {
  test('emits the first snapshot immediately', () => {
    const emitted: Array<{ count: number; files: string[] }> = [];
    const progress = new ReviewQueueProgress((snapshot) => emitted.push({ count: snapshot.count, files: [...snapshot.files] }));
    progress.update({ count: 3, files: ['a.ts'] });
    assert.deepStrictEqual(emitted, [{ count: 3, files: ['a.ts'] }]);
    progress.dispose();
  });

  test('throttles subsequent snapshots and keeps the latest', async () => {
    const emitted: Array<{ count: number; files: string[] }> = [];
    const progress = new ReviewQueueProgress((snapshot) => emitted.push({ count: snapshot.count, files: [...snapshot.files] }));
    progress.update({ count: 3, files: ['a.ts'] });
    progress.update({ count: 2, files: ['b.ts'] });
    progress.update({ count: 1, files: ['c.ts'] });
    assert.deepStrictEqual(emitted, [{ count: 3, files: ['a.ts'] }]);
    await delay(REVIEW_QUEUE_THROTTLE_MS + 50);
    assert.deepStrictEqual(emitted, [
      { count: 3, files: ['a.ts'] },
      { count: 1, files: ['c.ts'] },
    ]);
    progress.dispose();
  });

  test('flushes immediately when count is 0 and drops the trailing snapshot', async () => {
    const emitted: number[] = [];
    const progress = new ReviewQueueProgress((snapshot) => emitted.push(snapshot.count));
    progress.update({ count: 3, files: ['a.ts'] });
    progress.update({ count: 2, files: ['b.ts'] });
    progress.update({ count: 0, files: [] });
    assert.deepStrictEqual(emitted, [3, 0]);
    await delay(REVIEW_QUEUE_THROTTLE_MS + 50);
    assert.deepStrictEqual(emitted, [3, 0]);
    progress.dispose();
  });
});
