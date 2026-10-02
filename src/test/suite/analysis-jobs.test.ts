import * as assert from 'assert';
import * as path from 'path';
import vscode from 'vscode';
import { analysisJobsToCwf, getHomeData } from '../../code-health-monitor/home/home-props-utils';
import { analysisProgressTooltip } from '../../cs-statusbar';

suite('analysisJobsToCwf', () => {
  const root = path.join('/repo');
  const cases: Array<{
    name: string;
    running?: string[];
    queued?: string[];
    repoRoots?: string[];
    expected: Array<{ fileName: string; state: 'running' | 'queued' }>;
  }> = [
    { name: 'empty when neither running nor queued', expected: [] },
    {
      name: 'maps running jobs as running',
      running: [path.join(root, 'a.ts')],
      repoRoots: [root],
      expected: [{ fileName: path.join(root, 'a.ts'), state: 'running' }],
    },
    {
      name: 'maps queued jobs as queued',
      queued: ['b.ts', 'c.ts'],
      repoRoots: [root],
      expected: [
        { fileName: path.join(root, 'b.ts'), state: 'queued' },
        { fileName: path.join(root, 'c.ts'), state: 'queued' },
      ],
    },
    {
      name: 'marks a listed path running when it matches an editor review',
      running: [path.join(root, 'a.ts')],
      queued: ['a.ts', 'b.ts'],
      repoRoots: [root],
      expected: [
        { fileName: path.join(root, 'a.ts'), state: 'running' },
        { fileName: path.join(root, 'b.ts'), state: 'queued' },
      ],
    },
    {
      name: 'appends editor reviews that are not in the progress list',
      running: [path.join(root, 'dirty.ts')],
      queued: ['a.ts'],
      repoRoots: [root],
      expected: [
        { fileName: path.join(root, 'a.ts'), state: 'queued' },
        { fileName: path.join(root, 'dirty.ts'), state: 'running' },
      ],
    },
    {
      name: 'keeps a relative path when it matches more than one repo',
      queued: ['src/a.ts'],
      repoRoots: [path.join('/repo-a'), path.join('/repo-b')],
      expected: [{ fileName: 'src/a.ts', state: 'queued' }],
    },
  ];

  for (const { name, running, queued, repoRoots, expected } of cases) {
    test(name, () => {
      assert.deepStrictEqual(
        analysisJobsToCwf(running, queued, repoRoots).map((job) => ({ fileName: job.file.fileName, state: job.state })),
        expected
      );
    });
  }

  test('resolves a progress file to the one open document when several repos are known', () => {
    const repoA = path.join('/repo-a');
    const fileName = path.join(repoA, 'src', 'a.ts');
    const documents = vscode.workspace.textDocuments as vscode.TextDocument[];
    const previous = [...documents];
    documents.splice(0, documents.length, { fileName } as vscode.TextDocument);
    try {
      assert.deepStrictEqual(
        analysisJobsToCwf(undefined, ['src/a.ts'], [repoA, path.join('/repo-b')]).map((job) => ({
          fileName: job.file.fileName,
          state: job.state,
        })),
        [{ fileName, state: 'queued' }]
      );
    } finally {
      documents.splice(0, documents.length, ...previous);
    }
  });
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

suite('getHomeData', () => {
  test('forwards analysisState, totalCount and remainingCount', () => {
    const payload = getHomeData({
      fileDeltaData: [],
      jobs: [],
      showOnboarding: false,
      analysisState: 'running',
      totalCount: 11,
      remainingCount: 4,
      signedIn: true,
      user: { name: 'Ada' },
    });
    assert.strictEqual(payload.view, 'home');
    if (payload.view !== 'home') return;
    assert.strictEqual(payload.data.analysisState, 'running');
    assert.strictEqual(payload.data.totalCount, 11);
    assert.strictEqual(payload.data.remainingCount, 4);
  });
});
