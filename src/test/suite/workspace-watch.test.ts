import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  isExcludedByConfiguration,
  WorkspaceWatch,
  WorkspaceWatchDependencies,
} from '../../git/workspace-watch';
import { ReviewPipeline, ReviewSubmission } from '../../review/review-pipeline';

const STATUS_MODIFIED = 5;

suite('WorkspaceWatch Test Suite', () => {
  const repoRoot = path.normalize('/repo');
  let submitted: Array<{ repoRoot: string; baseline: string; submissions: ReviewSubmission[] }>;
  let watches: Array<{ repoRoot: string; baseline?: string }>;
  let stops: string[];
  let pipeline: Pick<ReviewPipeline, 'submitBatch'>;
  let dirtyDoc: vscode.TextDocument;
  let trackedDoc: vscode.TextDocument;
  let dependencies: WorkspaceWatchDependencies;
  let watch: WorkspaceWatch;
  let workingTreeChanges: Array<{ uri: vscode.Uri; status: number }>;
  let committedPaths: Set<string>;
  let shouldSkip: boolean;
  let baseline: string;
  let headCommit: string;

  setup(() => {
    submitted = [];
    watches = [];
    stops = [];
    workingTreeChanges = [];
    committedPaths = new Set();
    shouldSkip = false;
    baseline = 'baseline-sha';
    headCommit = 'head-sha';
    dirtyDoc = fakeDocument(path.join(repoRoot, 'dirty.ts'), 'const dirty = 1;', true);
    trackedDoc = fakeDocument(path.join(repoRoot, 'tracked.ts'), 'const tracked = 1;', false);
    pipeline = {
      submitBatch: async (root, baselineRevision, epoch, submissions) => {
        void epoch;
        submitted.push({ repoRoot: root, baseline: baselineRevision, submissions });
        return submissions.map(() => undefined);
      },
    };
    dependencies = {
      repositories: () => [
        {
          rootUri: vscode.Uri.file(repoRoot),
          state: {
            HEAD: { name: 'feature', commit: headCommit },
            workingTreeChanges,
            indexChanges: [],
            untrackedChanges: [],
            mergeChanges: [],
            onDidChange: () => ({ dispose: () => undefined }),
          },
        } as any,
      ],
      textDocuments: () => [dirtyDoc],
      isExcluded: () => false,
      shouldSkipRepo: async () => shouldSkip,
      getBaselineRevision: async () => baseline,
      getCommittedPaths: async () => committedPaths,
    };
    watch = new WorkspaceWatch(
      {
        watchFiles: (root, baselineRevision) => watches.push({ repoRoot: root, baseline: baselineRevision }),
        stopWatchFiles: (root) => stops.push(root),
      },
      pipeline as ReviewPipeline,
      dependencies
    );
  });

  teardown(() => watch.dispose());

  test('watches a repo and seeds dirty buffers with content and git-changed files without content', async () => {
    workingTreeChanges = [{ uri: trackedDoc.uri, status: STATUS_MODIFIED }];
    committedPaths = new Set(['committed.ts']);

    await watch.syncAll();

    assert.strictEqual(watches.length, 1);
    assert.strictEqual(watches[0].baseline, 'baseline-sha');
    assert.strictEqual(submitted.length, 1);
    const byPath = new Map(submitted[0].submissions.map((submission) => [submission.relPath, submission]));
    assert.strictEqual(byPath.get('dirty.ts')?.content, 'const dirty = 1;');
    assert.strictEqual(byPath.get('tracked.ts')?.content, undefined);
    assert.strictEqual(byPath.get('committed.ts')?.content, undefined);
  });

  test('does not re-watch or re-seed when baseline and HEAD are unchanged', async () => {
    workingTreeChanges = [{ uri: trackedDoc.uri, status: STATUS_MODIFIED }];
    await watch.syncAll();
    await watch.syncAll();
    assert.strictEqual(watches.length, 1);
    assert.strictEqual(submitted.length, 1);
  });

  test('restarts watch when the baseline changes', async () => {
    await watch.syncAll();
    baseline = 'baseline-2';
    await watch.syncAll();
    assert.deepStrictEqual(watches.map((entry) => entry.baseline), ['baseline-sha', 'baseline-2']);
    assert.deepStrictEqual(stops, [watches[0].repoRoot]);
  });

  test('stops watch on the default branch and does not seed', async () => {
    workingTreeChanges = [{ uri: trackedDoc.uri, status: STATUS_MODIFIED }];
    await watch.syncAll();
    shouldSkip = true;
    await watch.syncAll();
    assert.deepStrictEqual(stops, [watches[0].repoRoot]);
    assert.strictEqual(submitted.length, 1);
  });

  test('isExcludedByConfiguration matches nested exclude patterns', () => {
    const workspace = vscode.workspace as any;
    const originalGetConfiguration = workspace.getConfiguration;
    const originalGetWorkspaceFolder = workspace.getWorkspaceFolder;
    workspace.getConfiguration = () => ({
      get: () => ({ dist: true }),
    });
    workspace.getWorkspaceFolder = () => ({ uri: vscode.Uri.file(repoRoot) });
    try {
      assert.strictEqual(
        isExcludedByConfiguration(vscode.Uri.file(path.join(repoRoot, 'dist', 'out.js'))),
        true
      );
    } finally {
      workspace.getConfiguration = originalGetConfiguration;
      workspace.getWorkspaceFolder = originalGetWorkspaceFolder;
    }
  });
});

function fakeDocument(filePath: string, content: string, isDirty: boolean): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(filePath),
    fileName: filePath,
    isDirty,
    getText: () => content,
    version: 1,
  } as vscode.TextDocument;
}
