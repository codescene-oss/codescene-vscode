import * as assert from 'assert';
import * as path from 'path';
import { monitorJobCounts } from '../../code-health-monitor/home/analysis-batch';

suite('monitorJobCounts', () => {
  const root = path.join('/repo');
  const cases: Array<{
    name: string;
    running?: string[];
    queued?: string[];
    queueCount?: number;
    queueDone?: number;
    repoRoots?: string[];
    expected: { totalCount: number; remainingCount: number };
  }> = [
    { name: 'zero when nothing is running or queued', expected: { totalCount: 0, remainingCount: 0 } },
    {
      name: 'adds finished reviews to the remaining count',
      queueCount: 2,
      queueDone: 1,
      expected: { totalCount: 3, remainingCount: 2 },
    },
    {
      name: 'uses queue count when the files list is capped',
      queued: Array.from({ length: 20 }, (_, i) => `f${i}.ts`),
      queueCount: 500,
      queueDone: 10,
      expected: { totalCount: 510, remainingCount: 500 },
    },
    {
      name: 'counts editor reviews that are not in the progress list',
      running: [path.join(root, 'dirty.ts')],
      queued: ['a.ts'],
      queueCount: 1,
      queueDone: 0,
      repoRoots: [root],
      expected: { totalCount: 2, remainingCount: 2 },
    },
    {
      name: 'does not double-count an editor review listed in progress',
      running: [path.join(root, 'a.ts')],
      queued: ['a.ts', 'b.ts'],
      queueCount: 5,
      queueDone: 2,
      repoRoots: [root],
      expected: { totalCount: 7, remainingCount: 5 },
    },
    {
      name: 'counts an editor review before the first progress report',
      running: [path.join(root, 'a.ts')],
      repoRoots: [root],
      expected: { totalCount: 1, remainingCount: 1 },
    },
    {
      name: 'clears the total when the batch has drained',
      queueCount: 0,
      queueDone: 3,
      expected: { totalCount: 0, remainingCount: 0 },
    },
  ];

  for (const { name, running, queued, queueCount, queueDone, repoRoots, expected } of cases) {
    test(name, () => {
      assert.deepStrictEqual(monitorJobCounts(running, queued, queueCount, queueDone, repoRoots), expected);
    });
  }
});
