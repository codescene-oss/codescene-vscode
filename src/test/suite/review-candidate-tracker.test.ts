import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  isExcludedByConfiguration,
  ReviewCandidateTracker,
  ReviewCandidateTrackerDependencies,
} from '../../git/review-candidate-tracker';
import { ReviewPipeline, ReviewSubmission } from '../../review/review-pipeline';

const STATUS_MODIFIED = 5;

suite('ReviewCandidateTracker Test Suite', () => {
  const repoRoot = path.normalize('/repo');
  let submitted: Array<{ repoRoot: string; baseline: string; submissions: ReviewSubmission[] }>;
  let removed: vscode.TextDocument[];
  let pipeline: Pick<ReviewPipeline, 'submitBatch' | 'remove'>;
  let dirtyDoc: vscode.TextDocument;
  let trackedDoc: vscode.TextDocument;
  let dependencies: ReviewCandidateTrackerDependencies;
  let tracker: ReviewCandidateTracker;
  let workingTreeChanges: Array<{ uri: vscode.Uri; status: number }>;
  let untrackedChanges: Array<{ uri: vscode.Uri; status: number }>;
  let committedPaths: Set<string>;
  let shouldSkip: boolean;
  let focused: boolean;

  setup(() => {
    submitted = [];
    removed = [];
    workingTreeChanges = [];
    untrackedChanges = [];
    committedPaths = new Set();
    shouldSkip = false;
    focused = true;
    dirtyDoc = fakeDocument(path.join(repoRoot, 'dirty.ts'), 'const dirty = 1;', true);
    trackedDoc = fakeDocument(path.join(repoRoot, 'tracked.ts'), 'const tracked = 1;', false);
    pipeline = {
      submitBatch: async (root, baseline, epoch, submissions) => {
        void epoch;
        submitted.push({ repoRoot: root, baseline, submissions });
        return submissions.map(() => undefined);
      },
      remove: (root, documents) => {
        void root;
        removed.push(...documents);
      },
    };
    dependencies = {
      repositories: () => [
        {
          rootUri: vscode.Uri.file(repoRoot),
          state: {
            HEAD: { name: 'feature', commit: 'head-sha' },
            workingTreeChanges,
            indexChanges: [],
            untrackedChanges,
            mergeChanges: [],
            onDidChange: () => ({ dispose: () => undefined }),
          },
        } as any,
      ],
      openDocument: async (filePath) => {
        if (filePath.endsWith('tracked.ts')) return trackedDoc;
        if (filePath.endsWith('dirty.ts')) return dirtyDoc;
        throw new Error(`missing ${filePath}`);
      },
      textDocuments: () => [dirtyDoc],
      ignoredPaths: async () => new Set(),
      isExcluded: () => false,
      shouldSkipRepo: async () => shouldSkip,
      getBaselineRevision: async () => 'baseline-sha',
      getCommittedPaths: async () => committedPaths,
      isWindowFocused: () => focused,
    };
    tracker = new ReviewCandidateTracker(pipeline as ReviewPipeline, dependencies);
  });

  teardown(() => tracker.dispose());

  test('submits scm, committed, and dirty candidates in one batch', async () => {
    workingTreeChanges = [{ uri: trackedDoc.uri, status: STATUS_MODIFIED }];
    committedPaths = new Set(['committed.ts']);
    const committedDoc = fakeDocument(path.join(repoRoot, 'committed.ts'), 'const committed = 1;', false);
    dependencies.openDocument = async (filePath) => {
      if (filePath.endsWith('tracked.ts')) return trackedDoc;
      if (filePath.endsWith('committed.ts')) return committedDoc;
      if (filePath.endsWith('dirty.ts')) return dirtyDoc;
      throw new Error(`missing ${filePath}`);
    };

    await tracker.reconcileNow();

    assert.strictEqual(submitted.length, 1);
    assert.strictEqual(submitted[0].baseline, 'baseline-sha');
    const paths = submitted[0].submissions.map((submission) => submission.relPath).sort();
    assert.deepStrictEqual(paths, ['committed.ts', 'dirty.ts', 'tracked.ts']);
  });

  test('caches committed-since-baseline lookup by head and baseline', async () => {
    let calls = 0;
    committedPaths = new Set(['committed.ts']);
    const committedDoc = fakeDocument(path.join(repoRoot, 'committed.ts'), 'const committed = 1;', false);
    dependencies.openDocument = async () => committedDoc;
    dependencies.getCommittedPaths = async () => {
      calls += 1;
      return committedPaths;
    };

    await tracker.reconcileNow();
    await tracker.reconcileNow();
    assert.strictEqual(calls, 1);
  });

  test('does not resubmit when candidate set and content are unchanged', async () => {
    workingTreeChanges = [{ uri: trackedDoc.uri, status: STATUS_MODIFIED }];
    await tracker.reconcileNow();
    assert.strictEqual(submitted.length, 1);
    await tracker.reconcileNow();
    assert.strictEqual(submitted.length, 1);
  });

  test('skips reconciliation on default branch and clears previous candidates', async () => {
    workingTreeChanges = [{ uri: trackedDoc.uri, status: STATUS_MODIFIED }];
    dependencies.shouldSkipRepo = async () => false;
    await tracker.reconcileNow();
    const afterSubmit = submitted.length;
    assert.ok(afterSubmit > 0);

    dependencies.shouldSkipRepo = async () => true;
    await tracker.reconcileNow();
    assert.ok(removed.length > 0);
    assert.strictEqual(submitted.length, afterSubmit);

    await tracker.reconcileNow();
    assert.strictEqual(submitted.length, afterSubmit);
  });

  test('does nothing when the window is unfocused', async () => {
    focused = false;
    workingTreeChanges = [{ uri: trackedDoc.uri, status: STATUS_MODIFIED }];
    await tracker.reconcileNow();
    assert.strictEqual(submitted.length, 0);
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
