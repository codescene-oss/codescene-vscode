import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ReviewQueue, ServerStartEvent, WatchInventory } from '../../devtools-api/ide-server-client';
import {
  INVENTORY_REFRESH_DELAY_MS,
  isExcludedByConfiguration,
  WatchClient,
  WorkspaceWatch,
  WorkspaceWatchDependencies,
} from '../../git/workspace-watch';
import { ReviewPipeline, ReviewSubmission } from '../../review/review-pipeline';
import { assertLogContains } from '../setup';

suite('WorkspaceWatch Test Suite', () => {
  const queueIdleDelayMs = 20;
  const repoRoot = path.normalize('/repo');
  const bumpyRoad = path.join(repoRoot, 'CSharp', 'BumpyRoadExample2.cs');
  let submitted: Array<{ repoRoot: string; submissions: ReviewSubmission[] }>;
  let watches: Array<{ repoRoot: string; relativePaths?: string[] }>;
  let stops: string[];
  let workspaceFolders: string[];
  let openedRepositories: string[];
  let gitRoots: string[];
  let rootLookups: string[];
  let pruned: Array<{ repoRoots: string[]; keepPaths: Set<string> }>;
  let inventoryRequests: string[];
  let inventoryFiles: string[];
  let inventoryError: Error | undefined;
  let inventoryEmitter: vscode.EventEmitter<WatchInventory>;
  let serverStartEmitter: vscode.EventEmitter<ServerStartEvent>;
  let queueEmitter: vscode.EventEmitter<ReviewQueue>;
  let pipeline: Pick<ReviewPipeline, 'submitBatch'>;
  let dirtyDoc: vscode.TextDocument;
  let dependencies: WorkspaceWatchDependencies;
  let watch: WorkspaceWatch;
  let headName: string;
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
    headName = 'feature';
    headCommit = 'head-sha';
    workspaceFolders = [repoRoot];
    openedRepositories = [repoRoot];
    gitRoots = [repoRoot];
    rootLookups = [];
    inventoryEmitter = new vscode.EventEmitter<WatchInventory>();
    serverStartEmitter = new vscode.EventEmitter<ServerStartEvent>();
    queueEmitter = new vscode.EventEmitter<ReviewQueue>();
    dirtyDoc = fakeDocument(path.join(repoRoot, 'dirty.ts'), 'const dirty = 1;', true);
    pipeline = {
      submitBatch: async (root, submissions) => {
        submitted.push({ repoRoot: root, submissions });
        return submissions.map(() => undefined);
      },
    };
    dependencies = {
      queueIdleDelayMs,
      repositories: () =>
        openedRepositories.map(
          (root) =>
            ({
              rootUri: vscode.Uri.file(root),
              state: {
                HEAD: { name: headName, commit: headCommit },
                workingTreeChanges: [],
                indexChanges: [],
                untrackedChanges: [],
                mergeChanges: [],
                onDidChange: () => ({ dispose: () => undefined }),
              },
            } as any)
        ),
      workspaceFolders: () =>
        workspaceFolders.map((fsPath, index) => ({
          uri: vscode.Uri.file(fsPath),
          name: `folder-${index}`,
          index,
        })),
      gitRootFor: async (directory) => {
        rootLookups.push(directory);
        return gitRoots.find((root) => directory === root || directory.startsWith(root + path.sep));
      },
      textDocuments: () => [dirtyDoc],
      isExcluded: () => false,
      pruneMonitor: (repoRoots, keepPaths) => pruned.push({ repoRoots, keepPaths }),
    };
    const client: WatchClient = {
      watchFiles: (repoRoot, relativePaths) => void watches.push({ repoRoot, relativePaths }),
      stopWatchFiles: (root) => void stops.push(root),
      getWatchInventory: async (root) => {
        inventoryRequests.push(root);
        if (inventoryError) throw inventoryError;
        return { repoRoot: root, files: inventoryFiles };
      },
      onDidWatchInventory: inventoryEmitter.event,
      onDidServerStart: serverStartEmitter.event,
      onDidQueue: queueEmitter.event,
    };
    watch = new WorkspaceWatch(client, pipeline as ReviewPipeline, dependencies);
  });

  teardown(() => {
    watch.dispose();
    inventoryEmitter.dispose();
    serverStartEmitter.dispose();
    queueEmitter.dispose();
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
    assertLogContains('info', 'action=startWatch');
    assertLogContains('debug', 'syncing count=1 fromGitApi=1 fromResolveGitRoot=0');
  });

  test('watches the whole repository when a workspace folder is the git root', async () => {
    await watch.syncAll();

    assert.deepStrictEqual(watches, [{ repoRoot, relativePaths: undefined }]);
  });

  test('narrows the watch to the workspace folder inside a monorepo', async () => {
    workspaceFolders = [path.join(repoRoot, 'packages', 'app')];

    await watch.syncAll();

    assert.deepStrictEqual(watches, [{ repoRoot, relativePaths: ['packages/app'] }]);
  });

  test('sends every workspace folder of a repository in one call, since the call replaces the roots', async () => {
    workspaceFolders = [path.join(repoRoot, 'packages', 'app'), path.join(repoRoot, 'packages', 'lib')];

    await watch.syncAll();

    assert.deepStrictEqual(watches, [{ repoRoot, relativePaths: ['packages/app', 'packages/lib'] }]);
  });

  test('resends the full root list when the workspace folders change but HEAD does not', async () => {
    workspaceFolders = [path.join(repoRoot, 'packages', 'app')];
    await watch.syncAll();

    workspaceFolders = [path.join(repoRoot, 'packages', 'app'), path.join(repoRoot, 'packages', 'lib')];
    await watch.syncAll();

    assert.deepStrictEqual(watches, [
      { repoRoot, relativePaths: ['packages/app'] },
      { repoRoot, relativePaths: ['packages/app', 'packages/lib'] },
    ]);
  });

  test('watches a repository the git extension declined to open for a folder inside it', async () => {
    openedRepositories = [];
    workspaceFolders = [path.join(repoRoot, 'CSharp')];

    await watch.syncAll();

    assert.deepStrictEqual(watches, [{ repoRoot, relativePaths: ['CSharp'] }]);
  });

  test('does not watch a workspace folder that lies outside any repository', async () => {
    openedRepositories = [];
    workspaceFolders = [path.normalize('/elsewhere')];

    await watch.syncAll();

    assert.deepStrictEqual(watches, []);
  });

  test('reuses one root lookup per folder across syncs, since repository state changes are frequent', async () => {
    openedRepositories = [];
    workspaceFolders = [path.join(repoRoot, 'CSharp')];

    await watch.syncAll();
    await watch.syncAll();

    assert.deepStrictEqual(rootLookups, [path.join(repoRoot, 'CSharp')]);
  });

  test('forgets the root of a folder that left the workspace', async () => {
    openedRepositories = [];
    const folder = path.join(repoRoot, 'CSharp');
    workspaceFolders = [folder];
    await watch.syncAll();

    workspaceFolders = [];
    await watch.syncAll();
    workspaceFolders = [folder];
    await watch.syncAll();

    assert.deepStrictEqual(rootLookups, [folder, folder]);
  });

  test('keeps tracking HEAD through the repository the git extension did open', async () => {
    workspaceFolders = [path.join(repoRoot, 'CSharp')];
    await watch.syncAll();
    headCommit = 'head-sha-2';

    await watch.syncAll();

    assert.strictEqual(watches.length, 1, 'The CLI reacts to HEAD itself, so the watch is never restarted');
    assert.strictEqual(submitted.length, 2, 'Dirty buffers are invisible to the CLI and must be resent');
  });

  test('does not watch a repository the workspace does not reach into', async () => {
    workspaceFolders = [];

    await watch.syncAll();

    assert.deepStrictEqual(watches, []);
    assert.strictEqual(submitted.length, 0);
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
    assertLogContains('debug', 'action=skip');
    assertLogContains('debug', 'reason=head-unchanged');
  });

  test('keeps the CLI watch but re-seeds dirty buffers when HEAD moves', async () => {
    await watch.syncAll();
    headCommit = 'head-sha-2';
    await watch.syncAll();

    assert.strictEqual(watches.length, 1, 'The CLI reacts to HEAD itself, so the watch is never restarted');
    assert.deepStrictEqual(stops, []);
    assert.strictEqual(submitted.length, 2, 'Dirty buffers are invisible to the CLI and must be resent');
    assertLogContains('info', 'action=reseed');
  });

  test('watches the default branch too, where the change set is the uncommitted work', async () => {
    headName = 'main';

    await watch.syncAll();

    assert.deepStrictEqual(watches, [{ repoRoot, relativePaths: undefined }]);
    assert.deepStrictEqual(stops, []);
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

  test('drops a repository from the monitor when the workspace stops reaching into it', async () => {
    await watch.syncAll();
    inventoryEmitter.fire({ repoRoot, files: ['CSharp/BumpyRoadExample2.cs'] });

    workspaceFolders = [];
    await watch.syncAll();

    assert.deepStrictEqual(stops, [repoRoot]);
    assertLogContains('info', 'reason=no-scope');
    assert.deepStrictEqual(
      new Set(lastPruned()),
      new Set([dirtyDoc.uri.fsPath]),
      'A repository the workspace no longer reaches into has nothing left in the change set'
    );
  });

  test('matches a canonicalised inventory repo root back to the repository VS Code reports', async () => {
    await watch.syncAll();

    inventoryEmitter.fire({ repoRoot: path.join(repoRoot, 'sub', '..'), files: ['a.ts'] });

    assert.ok(lastPruned().has(path.join(repoRoot, 'a.ts')));
  });

  test('waits for the inventory a new watch pushes instead of racing the watch with a request', async () => {
    await watch.syncAll();

    assert.deepStrictEqual(watches, [{ repoRoot, relativePaths: undefined }]);
    assert.deepStrictEqual(inventoryRequests, [], 'The CLI sets the watch up asynchronously, so an early request fails');
    assertLogContains('debug', 'inventory refresh deferred');
    assertLogContains('debug', 'reason=awaiting-watch-push');

    inventoryEmitter.fire({ repoRoot, files: ['a.ts'] });

    assert.ok(lastPruned().has(path.join(repoRoot, 'a.ts')));
  });

  test('reconciles the inventory over request when an established watch is left in place', async () => {
    await watch.syncAll();
    inventoryFiles = ['a.ts'];

    await watch.syncAll();

    assert.deepStrictEqual(inventoryRequests, [repoRoot]);
    assert.ok(lastPruned().has(path.join(repoRoot, 'a.ts')));
    assertLogContains('debug', 'inventory refresh requested');
    assertLogContains('debug', 'inventory applied');
  });

  test('reconciles the inventory when HEAD moves and the watch is re-seeded', async () => {
    await watch.syncAll();
    headCommit = 'head-sha-2';
    inventoryFiles = ['a.ts'];

    await watch.syncAll();

    assert.deepStrictEqual(inventoryRequests, [repoRoot]);
    assert.ok(lastPruned().has(path.join(repoRoot, 'a.ts')));
    assertLogContains('info', 'action=reseed');
  });

  test('leaves the monitor untouched when the inventory request fails', async () => {
    await watch.syncAll();
    inventoryError = new Error('Repository is not watched');

    await watch.syncAll();

    assert.deepStrictEqual(pruned, []);
    assertLogContains('debug', 'inventory refresh skipped');
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
    setup(async () => {
      await watch.syncAll();
      inventoryEmitter.fire({ repoRoot, files: ['listed.ts'] });
      inventoryRequests.length = 0;
    });

    test('rejects a delta the refreshed change set confirms has left', async () => {
      inventoryFiles = ['listed.ts'];

      const admitted = await watch.admitsDelta(repoRoot, 'stale.ts');

      assert.strictEqual(admitted, false);
      assert.deepStrictEqual(inventoryRequests, [repoRoot]);
      assert.ok(!lastPruned().has(path.join(repoRoot, 'stale.ts')), 'The CLI confirmed the file has left the change set');
      assertLogContains('debug', 'delta reconcile scheduled');
      assertLogContains('debug', 'delta rejected');
      assertLogContains('debug', 'reason=not-in-inventory');
    });

    test('rejects every delta once the change set has emptied', async () => {
      inventoryEmitter.fire({ repoRoot, files: [] });
      inventoryFiles = [];

      const admitted = await Promise.all([
        watch.admitsDelta(repoRoot, 'mm/huge_memory.c'),
        watch.admitsDelta(repoRoot, 'drivers/net/ethernet/broadcom/bnxt/bnxt.c'),
      ]);

      assert.deepStrictEqual(admitted, [false, false]);
    });

    test('admits a delta the refreshed change set has caught up with', async () => {
      inventoryFiles = ['listed.ts', 'early.ts'];

      const admitted = await watch.admitsDelta(repoRoot, 'early.ts');

      assert.strictEqual(admitted, true, 'A delta that outran its inventory notification must still reach the monitor');
      assert.ok(lastPruned().has(path.join(repoRoot, 'early.ts')));
    });

    test('collapses a burst of deltas into a single reconcile', async () => {
      await Promise.all(['one.ts', 'two.ts', 'three.ts'].map((relPath) => watch.admitsDelta(repoRoot, relPath)));

      assert.deepStrictEqual(inventoryRequests, [repoRoot]);
    });

    const admittedWithoutReconcile = [
      { name: 'a listed file', root: repoRoot, relPath: 'listed.ts' },
      { name: 'a dirty buffer the CLI cannot see', root: repoRoot, relPath: 'dirty.ts' },
      { name: 'a repository without a reported inventory', root: path.normalize('/other'), relPath: 'any.ts' },
    ];

    admittedWithoutReconcile.forEach(({ name, root, relPath }) => {
      test(`admits ${name} without asking the CLI`, async () => {
        assert.strictEqual(await watch.admitsDelta(root, relPath), true);
        assert.deepStrictEqual(inventoryRequests, []);
      });
    });

    test('releases a pending admission when automatic analysis stops', async () => {
      const admission = watch.admitsDelta(repoRoot, 'stale.ts');

      watch.setEnabled(false);

      await admission;
      await new Promise((resolve) => setTimeout(resolve, INVENTORY_REFRESH_DELAY_MS + 50));
      assert.deepStrictEqual(inventoryRequests, []);
    });
  });

  suite('re-prune once the CLI queue goes idle', () => {
    const queue = (count: number): ReviewQueue => ({ count, files: [] });
    const settleIdle = () => new Promise((resolve) => setTimeout(resolve, queueIdleDelayMs + 30));

    const cases = [
      { name: 're-prunes once the queue stays empty', queueCounts: [0], pushed: true, enabled: true, expectedPrunes: 1 },
      {
        name: 'collapses a burst of empty-queue results into one re-prune',
        queueCounts: [0, 0, 0],
        pushed: true,
        enabled: true,
        expectedPrunes: 1,
      },
      { name: 'waits while work is still queued', queueCounts: [0, 2], pushed: true, enabled: true, expectedPrunes: 0 },
      { name: 're-prunes after the queue drains again', queueCounts: [2, 0], pushed: true, enabled: true, expectedPrunes: 1 },
      {
        name: 'does not re-prune before any inventory is known',
        queueCounts: [0],
        pushed: false,
        enabled: true,
        expectedPrunes: 0,
      },
      {
        name: 'does not re-prune while automatic analysis is stopped',
        queueCounts: [0],
        pushed: true,
        enabled: false,
        expectedPrunes: 0,
      },
    ];

    cases.forEach(({ name, queueCounts, pushed, enabled, expectedPrunes }) => {
      test(name, async () => {
        await watch.syncAll();
        if (pushed) inventoryEmitter.fire({ repoRoot, files: [] });
        if (!enabled) watch.setEnabled(false);
        const prunesBefore = pruned.length;
        inventoryRequests.length = 0;

        queueCounts.forEach((count) => queueEmitter.fire(queue(count)));
        await settleIdle();

        assert.strictEqual(pruned.length - prunesBefore, expectedPrunes);
        assert.deepStrictEqual(inventoryRequests, [], 'The re-prune uses the inventory the CLI already pushed');
      });
    });

    test('keeps listed files and dirty buffers when re-pruning', async () => {
      await watch.syncAll();
      inventoryEmitter.fire({ repoRoot, files: ['listed.ts'] });
      const prunesBefore = pruned.length;

      queueEmitter.fire(queue(0));
      await settleIdle();

      assert.strictEqual(pruned.length, prunesBefore + 1);
      assert.deepStrictEqual(new Set(lastPruned()), new Set([path.join(repoRoot, 'listed.ts'), dirtyDoc.uri.fsPath]));
      assertLogContains('debug', 'queue idle, monitor re-pruned');
    });
  });

  test('logs when a dirty buffer is excluded from seeding', async () => {
    dependencies.isExcluded = () => true;
    await watch.syncAll();
    assert.strictEqual(submitted.length, 0);
    assertLogContains('debug', 'seed skipped');
    assertLogContains('debug', 'reason=excluded');
  });

  test('setEnabled(false) stops watches without pruning the monitor', async () => {
    await watch.syncAll();
    inventoryEmitter.fire({ repoRoot, files: ['CSharp/BumpyRoadExample2.cs'] });
    const pruneCount = pruned.length;

    watch.setEnabled(false);

    assert.deepStrictEqual(stops, [repoRoot]);
    assert.strictEqual(pruned.length, pruneCount);
    assertLogContains('info', 'automatic analysis stopped');
  });

  test('does not re-watch or seed while automatic analysis is stopped', async () => {
    await watch.syncAll();
    watch.setEnabled(false);
    const watchCount = watches.length;
    const seedCount = submitted.length;

    headCommit = 'head-sha-2';
    await watch.syncAll();
    serverStartEmitter.fire({ metadata: { sha: 'sha', version: '1' }, restart: true });
    await watch.syncAll();

    assert.strictEqual(watches.length, watchCount);
    assert.strictEqual(submitted.length, seedCount);
  });

  test('setEnabled(true) re-establishes watches and seeds dirty buffers', async () => {
    await watch.syncAll();
    watch.setEnabled(false);

    watch.setEnabled(true);
    await watch.syncAll();

    assert.strictEqual(watches.length, 2);
    assert.strictEqual(submitted.length, 2);
    assertLogContains('info', 'automatic analysis started');
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
