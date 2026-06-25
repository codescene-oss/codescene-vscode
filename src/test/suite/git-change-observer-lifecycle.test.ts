import * as assert from 'assert';
import * as path from 'path';
import { Uri } from '../mocks/vscode';
import { GitChangeObserver } from '../../git/git-change-observer';
import { WorkspaceFileWatcher } from '../../git/workspace-file-watcher';
import { mockWorkspaceFolders, fireOnDidCreateFiles } from '../setup';
import { GitChangeObserverTestContext } from './git-change-observer-fixtures';

const mockSavedFilesTracker = { getSavedFiles: () => new Set<string>() } as any;
const mockOpenFilesObserver = { getAllVisibleFileNames: () => new Set<string>() } as any;

suite('GitChangeObserver lifecycle Test Suite', () => {
  let ctx: GitChangeObserverTestContext;

  setup(async function () {
    this.timeout(20000);
    ctx = new GitChangeObserverTestContext();
    await ctx.setup();
  });

  teardown(async () => {
    await ctx.teardown();
  });

  test('constructor throws when WorkspaceFileWatcher is not initialized', function () {
    this.timeout(20000);
    WorkspaceFileWatcher.disposeShared();

    assert.throws(
      () => new GitChangeObserver(ctx.mockContext, ctx.mockExecutor, mockSavedFilesTracker, mockOpenFilesObserver),
      /WorkspaceFileWatcher must be initialized/
    );
  });

  test('seedTrackerFromRepoState returns early when there is no workspace folder', function () {
    this.timeout(20000);
    mockWorkspaceFolders(undefined);

    const observer = new GitChangeObserver(ctx.mockContext, ctx.mockExecutor, mockSavedFilesTracker, mockOpenFilesObserver);
    assert.strictEqual((observer as any).initialTrackerSeedPromise, undefined, 'No seed scan should be scheduled');
    observer.dispose();
  });

  test('seedTrackerFromRepoState populates the tracker from existing repo state', async function () {
    this.timeout(20000);
    ctx.createFile('seeded.ts', 'export const seeded = 1;');

    const observer = new GitChangeObserver(ctx.mockContext, ctx.mockExecutor, mockSavedFilesTracker, mockOpenFilesObserver);
    await observer.waitForInitialTrackerSeed();

    const tracker = (observer as any).tracker as Set<string>;
    assert.ok(
      Array.from(tracker).some((file) => file.endsWith('seeded.ts')),
      'Pre-existing changed files should seed the deletion tracker'
    );
    observer.dispose();
  });

  test('workspace file events are pushed to the queue via the watcher subscription', function () {
    this.timeout(20000);
    ctx.gitChangeObserver.start();

    const observer = ctx.getObserverInternals();
    observer.eventQueue.length = 0;

    const filePath = ctx.createFile('watched.ts', 'export const watched = 1;');
    fireOnDidCreateFiles([Uri.file(filePath)]);

    assert.ok(
      observer.eventQueue.some((event: any) => event.type === 'create' && event.uri.fsPath === filePath),
      'Watcher file events should be queued by the observer subscription'
    );
  });

  test('reviewFile returns early when the document cannot be loaded', async function () {
    this.timeout(20000);
    const observer = ctx.getObserverInternals();
    const missingFile = path.join(ctx.testRepoPath, 'does-not-exist.ts');

    await assert.doesNotReject(observer.reviewFile(missingFile));
  });
});
