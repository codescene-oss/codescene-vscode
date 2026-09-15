import * as assert from 'assert';
import { analysisJobsToCwf } from '../../code-health-monitor/home/home-props-utils';
import { analysisProgressTooltip } from '../../cs-statusbar';

suite('analysisJobsToCwf', () => {
  const cases: Array<{
    name: string;
    running?: string[];
    queued?: string[];
    expected: Array<{ fileName: string; state: 'running' | 'queued' }>;
  }> = [
    { name: 'empty when neither running nor queued', expected: [] },
    {
      name: 'maps running jobs as running',
      running: ['/repo/a.ts'],
      expected: [{ fileName: '/repo/a.ts', state: 'running' }],
    },
    {
      name: 'maps queued jobs as queued',
      queued: ['/repo/b.ts', '/repo/c.ts'],
      expected: [
        { fileName: '/repo/b.ts', state: 'queued' },
        { fileName: '/repo/c.ts', state: 'queued' },
      ],
    },
    {
      name: 'omits queued paths that are already running',
      running: ['/repo/a.ts'],
      queued: ['/repo/a.ts', '/repo/b.ts'],
      expected: [
        { fileName: '/repo/a.ts', state: 'running' },
        { fileName: '/repo/b.ts', state: 'queued' },
      ],
    },
  ];

  for (const { name, running, queued, expected } of cases) {
    test(name, () => {
      assert.deepStrictEqual(
        analysisJobsToCwf(running, queued).map((job) => ({ fileName: job.file.fileName, state: job.state })),
        expected
      );
    });
  }
});

suite('analysisProgressTooltip', () => {
  const cases = [
    { name: 'default running tooltip when count is omitted', queueCount: undefined, expected: 'CodeScene analysis in progress...' },
    { name: 'default running tooltip when count is 0', queueCount: 0, expected: 'CodeScene analysis in progress...' },
    {
      name: 'includes remaining count when work is queued',
      queueCount: 12,
      expected: 'CodeScene analysis in progress (12 remaining)...',
    },
  ];

  for (const { name, queueCount, expected } of cases) {
    test(name, () => {
      assert.strictEqual(analysisProgressTooltip(queueCount), expected);
    });
  }
});
