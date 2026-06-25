import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { GitChangeLister } from '../../git/git-change-lister';
import { mockWorkspaceFolders, createMockWorkspaceFolder } from '../setup';
import { resetWorkspaceFileActivity } from '../../git/workspace-activity';
import Reviewer from '../../review/reviewer';
import {
  GIT_CHANGE_LISTER_TEST_REPO,
  GitChangeListerFixture,
  setupGitChangeListerFixture,
  teardownGitChangeListerFixture,
} from './git-change-lister-fixtures';

suite('GitChangeLister scan behavior Test Suite', () => {
  let fixture: GitChangeListerFixture;

  setup(async () => {
    fixture = await setupGitChangeListerFixture();
  });

  teardown(() => {
    teardownGitChangeListerFixture();
  });

  test('getAllChangedFiles detects renamed files', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const originalFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'original.js');
    fs.writeFileSync(originalFile, 'console.log("test");');
    execSync('git add original.js', { cwd: GIT_CHANGE_LISTER_TEST_REPO });
    execSync('git commit -m "Add original.js"', { cwd: GIT_CHANGE_LISTER_TEST_REPO });

    const renamedFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'renamed.js');
    fs.renameSync(originalFile, renamedFile);
    execSync('git add -A', { cwd: GIT_CHANGE_LISTER_TEST_REPO });

    const changedFiles = await fixture.gitChangeLister.getAllChangedFiles(GIT_CHANGE_LISTER_TEST_REPO, GIT_CHANGE_LISTER_TEST_REPO);

    assert.ok(changedFiles.size > 0);
    assert.ok(Array.from(changedFiles).some((f) => f.endsWith('renamed.js')));
  });

  test('getAllChangedFiles combines status and diff changes', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    execSync('git checkout -b feature-branch', { cwd: GIT_CHANGE_LISTER_TEST_REPO, stdio: 'pipe' });

    const committedFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'committed.ts');
    fs.writeFileSync(committedFile, 'export const foo = 1;');
    execSync('git add committed.ts', { cwd: GIT_CHANGE_LISTER_TEST_REPO });
    execSync('git commit -m "Add committed.ts"', { cwd: GIT_CHANGE_LISTER_TEST_REPO });

    const uncommittedFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'uncommitted.ts');
    fs.writeFileSync(uncommittedFile, 'export const bar = 2;');

    const changedFiles = await fixture.gitChangeLister.getAllChangedFiles(GIT_CHANGE_LISTER_TEST_REPO, GIT_CHANGE_LISTER_TEST_REPO);

    const fileNames = Array.from(changedFiles).map((f) => path.basename(f));
    assert.ok(fileNames.includes('uncommitted.ts'), 'Should include uncommitted file');
  });

  test('getAllChangedFiles handles files with whitespace in names', async function () {
    this.timeout(20000);

    const fileWithSpaces = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'my file.ts');
    const anotherFileWithSpaces = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'test file with spaces.js');
    fs.writeFileSync(fileWithSpaces, 'console.log("has spaces");');
    fs.writeFileSync(anotherFileWithSpaces, 'console.log("also has spaces");');

    const changedFiles = await fixture.gitChangeLister.getAllChangedFiles(GIT_CHANGE_LISTER_TEST_REPO, GIT_CHANGE_LISTER_TEST_REPO);

    const fileNames = Array.from(changedFiles).map((f) => path.basename(f));
    assert.ok(fileNames.includes('my file.ts'), 'Should include file with spaces: my file.ts');
    assert.ok(fileNames.includes('test file with spaces.js'), 'Should include file with spaces: test file with spaces.js');
  });

  test('start skips git when idle with cached file set', async function () {
    this.timeout(20000);
    mockWorkspaceFolders([createMockWorkspaceFolder(GIT_CHANGE_LISTER_TEST_REPO)]);

    let gitScanCount = 0;
    const originalGetAllChangedFiles = fixture.gitChangeLister.getAllChangedFiles.bind(fixture.gitChangeLister);
    fixture.gitChangeLister.getAllChangedFiles = async (...args) => {
      gitScanCount++;
      return originalGetAllChangedFiles(...args);
    };

    await fixture.gitChangeLister.start();
    assert.ok(gitScanCount >= 1, 'First start should run git');

    gitScanCount = 0;
    resetWorkspaceFileActivity();
    await fixture.gitChangeLister.start();
    assert.strictEqual(gitScanCount, 0, 'Idle start should skip git when file set is cached');

    fixture.gitChangeLister.markDirty();
    gitScanCount = 0;
    await fixture.gitChangeLister.start();
    assert.ok(gitScanCount >= 1, 'markDirty should force a git scan');
  });

  test('start schedules reviews for changed supported files', async function () {
    this.timeout(20000);
    mockWorkspaceFolders([createMockWorkspaceFolder(GIT_CHANGE_LISTER_TEST_REPO)]);

    const visibleFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'needs-review.ts');
    fs.writeFileSync(visibleFile, 'export const x = 1;');

    const reviewed: string[] = [];
    const reviewingExecutor = {
      execute: fixture.mockExecutor.execute.bind(fixture.mockExecutor),
      executeTask: async (task: () => Promise<void>) => task(),
      logStats: () => fixture.mockExecutor.logStats(),
      abortAllTasks: () => fixture.mockExecutor.abortAllTasks(),
    };

    const lister = new GitChangeLister(
      reviewingExecutor as any,
      { getSavedFiles: () => new Set<string>() } as any,
      () => new Set([visibleFile])
    );

    const originalReviewFiles = (lister as any).reviewFiles.bind(lister);
    (lister as any).reviewFiles = (filePaths: Set<string>) => {
      reviewed.push(...(lister as any).sortFilesByPriority(filePaths, new Set([visibleFile])));
      return originalReviewFiles(filePaths);
    };

    await lister.start();
    assert.ok(reviewed.length >= 1, 'Changed files should enqueue background reviews');
    assert.strictEqual(reviewed[0], visibleFile, 'Visible files should be reviewed first');
  });

  test('isAlreadyCached returns false when review cache is unavailable', () => {
    const lister = new GitChangeLister(fixture.mockExecutor as any, { getSavedFiles: () => new Set() } as any);
    const document = { fileName: '/tmp/file.ts', version: 1 } as any;
    assert.strictEqual((lister as any).isAlreadyCached(document), false);
  });

  test('start returns early when there is no workspace folder', async function () {
    this.timeout(20000);
    mockWorkspaceFolders(undefined);

    const lister = new GitChangeLister(fixture.mockExecutor as any, { getSavedFiles: () => new Set() } as any);
    let scanned = false;
    (lister as any).getAllChangedFiles = async () => {
      scanned = true;
      return new Set<string>();
    };

    await lister.start();
    assert.strictEqual(scanned, false, 'No git scan should run without a workspace folder');
  });

  test('sortFilesByPriority places non-visible files after visible ones', () => {
    const lister = new GitChangeLister(fixture.mockExecutor as any, { getSavedFiles: () => new Set() } as any);
    const visibleFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'visible.ts');
    const hiddenFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'hidden.ts');

    const sorted = (lister as any).sortFilesByPriority(
      new Set([hiddenFile, visibleFile]),
      new Set([visibleFile])
    );

    assert.deepStrictEqual(sorted, [visibleFile, hiddenFile]);
  });

  test('isAlreadyCached returns true when the review cache has the exact version', () => {
    const lister = new GitChangeLister(fixture.mockExecutor as any, { getSavedFiles: () => new Set() } as any);
    const original = (Reviewer as any)._instance;
    (Reviewer as any)._instance = { reviewCache: { getExactVersion: () => ({}) } };

    try {
      const document = { fileName: '/tmp/file.ts', version: 1 } as any;
      assert.strictEqual((lister as any).isAlreadyCached(document), true);
    } finally {
      (Reviewer as any)._instance = original;
    }
  });

  test('isAlreadyCached returns false when the review cache lookup throws', () => {
    const lister = new GitChangeLister(fixture.mockExecutor as any, { getSavedFiles: () => new Set() } as any);
    const original = (Reviewer as any)._instance;
    (Reviewer as any)._instance = {
      reviewCache: {
        getExactVersion: () => {
          throw new Error('cache exploded');
        },
      },
    };

    try {
      const document = { fileName: '/tmp/file.ts', version: 1 } as any;
      assert.strictEqual((lister as any).isAlreadyCached(document), false);
    } finally {
      (Reviewer as any)._instance = original;
    }
  });
});
