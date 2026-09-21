import * as assert from 'assert';
import { ReviewRequestQueue } from '../../diagnostics/review-request-queue';
import { ReviewOpts } from '../../review/reviewer';

suite('ReviewRequestQueue Test Suite', () => {
  const fileName = '/repo/src/file.ts';
  const firstOpts: ReviewOpts = { skipMonitorUpdate: false, updateDiagnosticsPane: true };
  const queuedOpts: ReviewOpts = { skipMonitorUpdate: false, updateDiagnosticsPane: true };

  test('cancel drops a queued review so finishReview does not fire it', () => {
    const queue = new ReviewRequestQueue();

    assert.strictEqual(queue.requestReview(fileName, firstOpts), true);
    assert.strictEqual(queue.requestReview(fileName, queuedOpts), false);

    queue.cancel(fileName);

    assert.strictEqual(queue.finishReview(fileName), undefined);
  });

  test('cancel of a file with no queued review is a no-op', () => {
    const queue = new ReviewRequestQueue();

    queue.cancel(fileName);

    assert.strictEqual(queue.requestReview(fileName, firstOpts), true);
    assert.strictEqual(queue.finishReview(fileName), undefined);
  });

  test('a later requestReview can run after cancel and finishReview', () => {
    const queue = new ReviewRequestQueue();

    assert.strictEqual(queue.requestReview(fileName, firstOpts), true);
    assert.strictEqual(queue.requestReview(fileName, queuedOpts), false);
    queue.cancel(fileName);
    queue.finishReview(fileName);

    assert.strictEqual(queue.requestReview(fileName, firstOpts), true);
  });
});
