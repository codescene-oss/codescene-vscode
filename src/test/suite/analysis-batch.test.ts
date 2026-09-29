import * as assert from 'assert';
import { AnalysisBatchTracker, remainingJobCount } from '../../code-health-monitor/home/analysis-batch';

suite('remainingJobCount', () => {
  const cases: Array<{
    name: string;
    running?: string[];
    queued?: string[];
    queueCount?: number;
    expected: number;
  }> = [
    { name: 'zero when nothing is running or queued', expected: 0 },
    {
      name: 'uses queueCount when the files list is capped',
      queued: Array.from({ length: 20 }, (_, i) => `/repo/f${i}.ts`),
      queueCount: 500,
      expected: 500,
    },
    {
      name: 'counts local running jobs that are not in the CLI queue',
      running: ['/repo/dirty.ts'],
      queued: ['/repo/a.ts'],
      queueCount: 1,
      expected: 2,
    },
    {
      name: 'does not double-count a running file that is also listed in the queue',
      running: ['/repo/a.ts'],
      queued: ['/repo/a.ts', '/repo/b.ts'],
      queueCount: 5,
      expected: 5,
    },
    {
      name: 'falls back to the job list when queueCount is omitted',
      running: ['/repo/a.ts'],
      queued: ['/repo/b.ts'],
      expected: 2,
    },
  ];

  for (const { name, running, queued, queueCount, expected } of cases) {
    test(name, () => {
      assert.strictEqual(remainingJobCount(running, queued, queueCount), expected);
    });
  }
});

suite('AnalysisBatchTracker', () => {
  test('snapshots remaining as the total when a batch starts', () => {
    const tracker = new AnalysisBatchTracker();
    assert.deepStrictEqual(tracker.update(5), { totalCount: 5, remainingCount: 5 });
  });

  test('keeps the snapshot while remaining drains', () => {
    const tracker = new AnalysisBatchTracker();
    tracker.update(5);
    assert.deepStrictEqual(tracker.update(3), { totalCount: 5, remainingCount: 3 });
  });

  test('grows the total when remaining increases mid-batch', () => {
    const tracker = new AnalysisBatchTracker();
    tracker.update(5);
    tracker.update(3);
    assert.deepStrictEqual(tracker.update(4), { totalCount: 6, remainingCount: 4 });
  });

  test('resets when remaining returns to idle', () => {
    const tracker = new AnalysisBatchTracker();
    tracker.update(5);
    tracker.update(0);
    assert.deepStrictEqual(tracker.update(2), { totalCount: 2, remainingCount: 2 });
  });

  test('reset forgets the previous batch', () => {
    const tracker = new AnalysisBatchTracker();
    tracker.update(11);
    tracker.reset();
    assert.deepStrictEqual(tracker.update(3), { totalCount: 3, remainingCount: 3 });
  });
});
