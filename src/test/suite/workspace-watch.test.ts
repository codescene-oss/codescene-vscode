import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { DeltaResult, ServerStartEvent, WatchInventory } from '../../devtools-api/ide-server-client';
import {
  INVENTORY_REFRESH_DELAY_MS,
  isExcludedByConfiguration,
  WatchClient,
  WorkspaceWatch,
  WorkspaceWatchDependencies,
} from '../../git/workspace-watch';
import { ReviewPipeline, ReviewSubmission } from '../../review/review-pipeline';

suite('WorkspaceWatch Test Suite', () => {
  const repoRoot = path.normalize('/repo');
  const bumpyRoad = path.join(repoRoot, 'CSharp', 'BumpyRoadExample2.cs');
  let submitted: Array<{ repoRoot: string; submissions: ReviewSubmission[] }>;
  let watches: string[];
  let stops: string[];
  let pruned: Array<{ repoRoots: string[]; keepPaths: Set<string> }>;
  let inventoryRequests: string[];
  let inventoryFiles: string[];
  let inventoryError: Error | undefined;
  let inventoryEmitter: vscode.EventEmitter<WatchInventory>;
  let serverStartEmitter: vscode.EventEmitter<ServerStartEvent>;
  let deltaEmitter: vscode.EventEmitter<DeltaResult>;
  let pipeline: Pick<ReviewPipeline, 'submitBatch'>;
  let dirtyDoc: vscode.TextDocument;
  let dependencies: WorkspaceWatchDependencies;
  let watch: WorkspaceWatch;
  let shouldSkip: boolean;
  let headCommit: string;

  const lastPruned = () => pruned[pruned.length - 1].keepPaths;

  setup(() => {
    submitted = [];
    watches = [];
    stops = [];
    pruned = [];
    inventoryRequests = [];
    inventoryFiles = [];
    inventoryError = undefined;
    shouldSkip = false;
    headCommit = 'head-sha';
    inventoryEmitter = new vscode.EventEmitter<WatchInventory>();
    serverStartEmitter = new vscode.EventEmitter<ServerStartEvent>();
    deltaEmitter = new vscode.EventEmitter<DeltaResult>();
    dirtyDoc = fakeDocument(path.join(repoRoot, 'dirty.ts'), 'const dirty = 1;', true);
    pipeline = {
      submitBatch: async (root, submissions) => {
        submitted.push({ repoRoot: root, submissions });
        return submissions.map(() => undefined);
      },
    };
    dependencies = {
      repositories: () => [
        {
          rootUri: vscode.Uri.file(repoRoot),
          state: {
            HEAD: { name: 'feature', commit: headCommit },
            workingTreeChanges: [],
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
      pruneMonitor: (repoRoots, keepPaths) => pruned.push({ repoRoots, keepPaths }),
    };
    const client: WatchClient = {
      watchFiles: (root) => void watches.push(root),
      stopWatchFiles: (root) => void stops.push(root),
      getWatchInventory: async (root) => {
        inventoryRequests.push(root);
        if (inventoryError) throw inventoryError;
        return { repoRoot: root, files: inventoryFiles };
      },
      onDidWatchInventory: inventoryEmitter.event,
      onDidServerStart: serverStartEmitter.event,
      onDidDelta: deltaEmitter.event,
    };
    watch = new WorkspaceWatch(client, pipeline as ReviewPipeline, dependencies);
  });

  teardown(() => {
    watch.dispose();
    inventoryEmitter.dispose();
    serverStartEmitter.dispose();
    deltaEmitter.dispose();
  });

  test('watches a repo and seeds only dirty buffers, leaving disk files to the CLI watch scan', async () => {
    await watch.syncAll();

    assert.strictEqual(watches.length, 1);
    assert.strictEqual(submitted.length, 1);
    assert.deepStrictEqual(
      submitted[0].submissions.map((submission) => submission.relPath),
      ['dirty.ts']
    );
    assert.strictEqual(submitted[0].submissions[0].content, 'const dirty = 1;');
  });

  test('does not seed when there are no dirty buffers', async () => {
    dirtyDoc = fakeDocument(path.join(repoRoot, 'clean.ts'), 'const clean = 1;', false);
    await watch.syncAll();
    assert.strictEqual(watches.length, 1);
    assert.strictEqual(submitted.length, 0);
  });

  test('does not re-watch or re-seed while HEAD is unchanged', async () => {
    await watch.syncAll();
    await watch.syncAll();
    assert.strictEqual(watches.length, 1);
    assert.strictEqual(submitted.length, 1);
  });

  test('keeps the CLI watch but re-seeds dirty buffers when HEAD moves', async () => {
    await watch.syncAll();
    headCommit = 'head-sha-2';
    await watch.syncAll();

    assert.strictEqual(watches.length, 1, 'The CLI reacts to HEAD itself, so the watch is never restarted');
    assert.deepStrictEqual(stops, []);
    assert.strictEqual(submitted.length, 2, 'Dirty buffers are invisible to the CLI and must be resent');
  });

  test('stops watch on the default branch and does not seed', async () => {
    await watch.syncAll();
    shouldSkip = true;
    await watch.syncAll();
    assert.deepStrictEqual(stops, [watches[0]]);
    assert.strictEqual(submitted.length, 1);
  });

  test('prunes the monitor to the reported inventory, keeping dirty buffers the CLI cannot see', async () => {
    await watch.syncAll();

    inventoryEmitter.fire({ repoRoot, files: ['CSharp/BumpyRoadExample2.cs'] });

    assert.deepStrictEqual(new Set(lastPruned()), new Set([bumpyRoad, dirtyDoc.uri.fsPath]));
  });

  test('scopes the prune to repositories the CLI has reported an inventory for', async () => {
    await watch.syncAll();

    inventoryEmitter.fire({ repoRoot, files: [] });

    assert.deepStrictEqual(pruned[pruned.length - 1].repoRoots, [repoRoot]);
  });

  test('drops a repository from the monitor when it returns to the default branch', async () => {
    await watch.syncAll();
    inventoryEmitter.fire({ repoRoot, files: ['CSharp/BumpyRoadExample2.cs'] });

    shouldSkip = true;
    await watch.syncAll();

    assert.deepStrictEqual(
      new Set(lastPruned()),
      new Set([dirtyDoc.uri.fsPath]),
      'Switching back to the default branch leaves nothing in the change set'
    );
  });

  test('matches a canonicalised inventory repo root back to the repository VS Code reports', async () => {
    await watch.syncAll();

    inventoryEmitter.fire({ repoRoot: path.join(repoRoot, 'sub', '..'), files: ['a.ts'] });

    assert.ok(lastPruned().has(path.join(repoRoot, 'a.ts')));
  });

  test('reconciles the inventory over request when an established watch is left in place', async () => {
    await watch.syncAll();
    inventoryFiles = ['a.ts'];

    await watch.syncAll();

    assert.deepStrictEqual(inventoryRequests, [repoRoot]);
    assert.ok(lastPruned().has(path.join(repoRoot, 'a.ts')));
  });

  test('leaves the monitor untouched when the inventory request fails', async () => {
    await watch.syncAll();
    inventoryError = new Error('Repository is not watched');

    await watch.syncAll();

    assert.deepStrictEqual(pruned, []);
  });

  test('re-establishes watches after the CLI server restarts', async () => {
    await watch.syncAll();

    serverStartEmitter.fire({ metadata: { sha: 'sha', version: '1' }, restart: true });
    await watch.syncAll();

    assert.strictEqual(watches.length, 2);
    assert.strictEqual(submitted.length, 2, 'Dirty buffers are re-seeded against the fresh watch');
  });

  test('ignores the first server start, which the initial sync already covers', async () => {
    await watch.syncAll();

    serverStartEmitter.fire({ metadata: { sha: 'sha', version: '1' }, restart: false });
    await watch.syncAll();

    assert.strictEqual(watches.length, 1);
  });

  suite('deltas outside the known change set', () => {
    const deltaFor = (relPath: string, result: DeltaResult['result'] = {} as DeltaResult['result']): DeltaResult => ({
      path: relPath,
      repoRoot,
      result,
    });

    const settleRefresh = () => new Promise((resolve) => setTimeout(resolve, INVENTORY_REFRESH_DELAY_MS + 50));

    setup(async () => {
      await watch.syncAll();
      inventoryEmitter.fire({ repoRoot, files: ['listed.ts'] });
      inventoryRequests.length = 0;
    });

    test('reconciles with the CLI when a delta names a file the change set omits', async () => {
      inventoryFiles = ['listed.ts'];

      deltaEmitter.fire(deltaFor('stale.ts'));
      await settleRefresh();

      assert.deepStrictEqual(inventoryRequests, [repoRoot]);
      assert.ok(!lastPruned().has(path.join(repoRoot, 'stale.ts')), 'The CLI confirmed the file has left the change set');
    });

    test('keeps a file the refreshed change set has caught up with', async () => {
      inventoryFiles = ['listed.ts', 'early.ts'];

      deltaEmitter.fire(deltaFor('early.ts'));
      await settleRefresh();

      assert.ok(
        lastPruned().has(path.join(repoRoot, 'early.ts')),
        'A delta that outran its inventory notification must not lose its monitor entry'
      );
    });

    test('collapses a burst of deltas into a single reconcile', async () => {
      deltaEmitter.fire(deltaFor('one.ts'));
      deltaEmitter.fire(deltaFor('two.ts'));
      deltaEmitter.fire(deltaFor('three.ts'));
      await settleRefresh();

      assert.deepStrictEqual(inventoryRequests, [repoRoot]);
    });

    test('ignores listed files, dirty buffers and empty deltas', async () => {
      deltaEmitter.fire(deltaFor('listed.ts'));
      deltaEmitter.fire(deltaFor('dirty.ts'));
      deltaEmitter.fire(deltaFor('stale.ts', null));
      await settleRefresh();

      assert.deepStrictEqual(inventoryRequests, []);
    });
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
