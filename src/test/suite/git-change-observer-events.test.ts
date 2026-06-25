import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Uri } from '../mocks/vscode';
import Reviewer from '../../review/reviewer';
import { ReviewCacheItem } from '../../review/review-cache-item';
import { CsReview } from '../../review/cs-review';
import { DevtoolsAPI } from '../../devtools-api';
import { TestTextDocument } from '../mocks/test-text-document';
import { GitChangeObserverTestContext } from './git-change-observer-fixtures';

suite('GitChangeObserver event processing Test Suite', () => {
  let ctx: GitChangeObserverTestContext;

  setup(async function () {
    this.timeout(20000);
    ctx = new GitChangeObserverTestContext();
    await ctx.setup();
  });

  teardown(() => {
    ctx.teardown();
  });

  test('dispose cleans up scheduled executor and workspace watcher reference', function () {
    this.timeout(20000);
    const observer = ctx.getObserverInternals();
    assert.ok(observer.workspaceWatcher, 'Workspace watcher should exist');
    assert.ok(observer.scheduledExecutor, 'Scheduled executor should exist');

    ctx.gitChangeObserver.dispose();
    assert.strictEqual(observer.scheduledExecutor.intervalHandle, null, 'Interval should be cleared after dispose');
  });

  test('events are queued instead of processed immediately', async function () {
    this.timeout(20000);
    const file1 = ctx.createFile('queued1.ts', 'export const a = 1;');
    const file2 = ctx.createFile('queued2.ts', 'export const b = 2;');

    ctx.gitChangeObserver.start();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const observer = ctx.getObserverInternals();
    observer.eventQueue.push({ type: 'create', uri: Uri.file(file1) });
    observer.eventQueue.push({ type: 'create', uri: Uri.file(file2) });

    assert.strictEqual(observer.eventQueue.length, 2, 'Events should get queued');
    ctx.assertFileInTracker(file1, false);
    ctx.assertFileInTracker(file2, false);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    assert.strictEqual(observer.eventQueue.length, 0, 'Queue should be empty after processing');
    ctx.assertFileInTracker(file1);
    ctx.assertFileInTracker(file2);
  });

  test('getChangedFilesVsBaseline is called once per batch, not per file', async function () {
    this.timeout(20000);
    const files = [
      ctx.createFile('cache1.ts', 'export const a = 1;'),
      ctx.createFile('cache2.ts', 'export const b = 2;'),
      ctx.createFile('cache3.ts', 'export const c = 3;'),
    ];

    ctx.gitChangeObserver.start();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const observer = ctx.getObserverInternals();

    let getChangedFilesCallCount = 0;
    const originalGetChangedFiles = ctx.gitChangeObserver.getChangedFilesVsBaseline.bind(ctx.gitChangeObserver);
    ctx.gitChangeObserver.getChangedFilesVsBaseline = async function (workspaceFolder) {
      getChangedFilesCallCount++;
      return originalGetChangedFiles(workspaceFolder);
    };

    for (const file of files) {
      observer.eventQueue.push({ type: 'create', uri: Uri.file(file) });
    }

    assert.strictEqual(getChangedFilesCallCount, 0, "getChangedFilesVsBaseline doesn't get called until the batch gets processed");

    await new Promise((resolve) => setTimeout(resolve, 1500));

    assert.strictEqual(getChangedFilesCallCount, 1, 'getChangedFilesVsBaseline should be called once per batch');
    files.forEach((file) => ctx.assertFileInTracker(file));
  });

  test('empty queue does not trigger unnecessary processing', async function () {
    this.timeout(20000);

    ctx.gitChangeObserver.start();
    await new Promise((resolve) => setTimeout(resolve, 500));

    let getChangedFilesCallCount = 0;
    const originalGetChangedFiles = ctx.gitChangeObserver.getChangedFilesVsBaseline.bind(ctx.gitChangeObserver);
    ctx.gitChangeObserver.getChangedFilesVsBaseline = async function (workspaceFolder) {
      getChangedFilesCallCount++;
      return originalGetChangedFiles(workspaceFolder);
    };

    await new Promise((resolve) => setTimeout(resolve, 5000));
    assert.strictEqual(getChangedFilesCallCount, 0, 'getChangedFilesVsBaseline should not be called for empty queue');
  });

  test('dispose clears scheduled executor interval', function () {
    this.timeout(20000);
    const observer = ctx.getObserverInternals();
    assert.ok(observer.scheduledExecutor, 'Scheduled executor should exist');

    ctx.gitChangeObserver.dispose();
    assert.strictEqual(observer.scheduledExecutor.intervalHandle, null, 'Interval should be cleared after dispose');
  });

  test('should not cache delta for file deleted during review', async function () {
    this.timeout(20000);

    if (!Reviewer.instance) {
      Reviewer.init(ctx.mockContext, async () => undefined, () => new Map());
    }

    const fileName = 'race-condition-test.ts';
    const originalContent = 'export function test() { return "original"; }';
    const filePath = ctx.commitFile(fileName, originalContent, 'Add test file');

    const modifiedContent = 'export function test() { return "modified"; }';
    fs.writeFileSync(filePath, modifiedContent);

    ctx.gitChangeObserver.start();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const document = new TestTextDocument(filePath, modifiedContent, 'typescript') as any as vscode.TextDocument;
    const mockReview: any = {
      score: 8.5,
      'raw-score': 'base64encodeddata',
      'file-level-code-smells': [],
      'function-level-code-smells': [],
    };
    const review = new CsReview(document, Promise.resolve(mockReview));

    let fileCheckStarted = false;
    let fileCheckResolve: (() => void) | undefined;
    let proceedWithStatResolve: (() => void) | undefined;

    const fileCheckPromise = new Promise<void>((resolve) => {
      fileCheckResolve = resolve;
    });
    const proceedWithStatPromise = new Promise<void>((resolve) => {
      proceedWithStatResolve = resolve;
    });

    const originalStat = vscode.workspace.fs.stat;
    vscode.workspace.fs.stat = async (uri: any) => {
      fileCheckStarted = true;
      fileCheckResolve?.();
      await proceedWithStatPromise;
      return originalStat.call(vscode.workspace.fs, uri);
    };

    let deltaCalled = false;
    const originalDelta = DevtoolsAPI.delta;
    DevtoolsAPI.delta = async (doc: any, updateMonitor: any, oldScore: any, newScore: any) => {
      deltaCalled = true;
      return originalDelta.call(DevtoolsAPI, doc, updateMonitor, oldScore, newScore);
    };

    try {
      const cacheItem = new ReviewCacheItem(document, review);
      const deltaPromise = cacheItem.runDeltaAnalysis({ skipMonitorUpdate: false });

      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('File check was never called - the bugfix may be missing')), 1000);
      });
      await Promise.race([fileCheckPromise, timeoutPromise]);
      assert.strictEqual(fileCheckStarted, true, 'File check should have started');

      fs.unlinkSync(filePath);
      proceedWithStatResolve?.();
      await deltaPromise;

      assert.strictEqual(deltaCalled, false, 'DevtoolsAPI.delta should not be called for deleted file');
      assert.strictEqual(cacheItem.delta, undefined, 'Delta should not be set for deleted file');
    } finally {
      vscode.workspace.fs.stat = originalStat;
      DevtoolsAPI.delta = originalDelta;
    }
  });
});
