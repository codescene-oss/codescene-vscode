import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Uri } from '../mocks/vscode';
import { getWorkspaceFolder } from '../../utils';
import { GitChangeObserverTestContext } from './git-change-observer-fixtures';

suite('GitChangeObserver file changes Test Suite', () => {
  let ctx: GitChangeObserverTestContext;

  setup(async function () {
    this.timeout(20000);
    ctx = new GitChangeObserverTestContext();
    await ctx.setup();
  });

  teardown(async () => {
    await ctx.teardown();
  });

  test('getChangedFilesVsBaseline returns empty array for clean repository', async function () {
    this.timeout(20000);
    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assert.strictEqual(changedFiles.length, 0);
  });

  test('getChangedFilesVsBaseline detects new untracked files', async function () {
    this.timeout(20000);
    ctx.createFile('test.ts', 'console.log("test");');
    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, 'test.ts');
  });

  test('getChangedFilesVsBaseline detects modified files', async function () {
    this.timeout(20000);
    const testFile = ctx.commitFile('index.js', 'console.log("hello");', 'Add index.js');
    fs.writeFileSync(testFile, 'console.log("modified");');
    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, 'index.js');
  });

  test('getChangedFilesVsBaseline detects staged files', async function () {
    this.timeout(20000);
    ctx.createFile('script.py', 'print("hello")');
    ctx.execGit('git add script.py');
    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, 'script.py');
  });

  test('getChangedFilesVsBaseline combines status and diff changes', async function () {
    this.timeout(20000);
    ctx.execGit('git checkout -b feature-branch');
    ctx.commitFile('committed.ts', 'export const foo = 1;', 'Add committed.ts');
    ctx.createFile('uncommitted.ts', 'export const bar = 2;');

    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, 'committed.ts');
    ctx.assertFileInChangedList(changedFiles, 'uncommitted.ts');
  });

  test('tracker tracks added files', async function () {
    this.timeout(20000);
    const newFile = ctx.createFile('tracked.ts', 'export const x = 1;');
    ctx.gitChangeObserver.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await ctx.triggerFileChange(newFile);
    ctx.assertFileInTracker(newFile);
  });

  test('removeFromTracker removes file from tracking', async function () {
    this.timeout(20000);
    const newFile = ctx.createFile('removable.ts', 'export const x = 1;');
    ctx.gitChangeObserver.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await ctx.triggerFileChange(newFile);
    ctx.assertFileInTracker(newFile);
    ctx.gitChangeObserver.removeFromTracker(newFile);
    ctx.assertFileInTracker(newFile, false);
  });

  test('handleFileDelete removes tracked file', async function () {
    this.timeout(20000);
    const newFile = ctx.createFile('deletable.ts', 'export const x = 1;');
    ctx.gitChangeObserver.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await ctx.triggerFileChange(newFile);
    ctx.assertFileInTracker(newFile);
    fs.unlinkSync(newFile);
    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    await ctx.getObserverInternals().handleFileDelete(Uri.file(newFile), changedFiles, workspaceFolder);
    ctx.assertFileInTracker(newFile, false);
  });

  test('handleFileDelete handles directory deletion', async function () {
    this.timeout(20000);
    const subDir = path.join(ctx.testRepoPath, 'subdir');
    fs.mkdirSync(subDir, { recursive: true });
    const file1 = path.join(subDir, 'file1.ts');
    const file2 = path.join(subDir, 'file2.ts');
    fs.writeFileSync(file1, 'export const a = 1;');
    fs.writeFileSync(file2, 'export const b = 2;');

    ctx.gitChangeObserver.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await ctx.triggerFileChange(file1);
    await ctx.triggerFileChange(file2);
    ctx.assertFileInTracker(file1);
    ctx.assertFileInTracker(file2);

    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    await ctx.getObserverInternals().handleFileDelete(Uri.file(subDir), changedFiles, workspaceFolder);
    ctx.assertFileInTracker(file1, false);
    ctx.assertFileInTracker(file2, false);
  });

  test('shouldProcessFile rejects unsupported file types', async function () {
    this.timeout(20000);
    const txtFile = ctx.createFile('notes.txt', 'Some notes');
    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    const shouldProcess = ctx.getObserverInternals().shouldProcessFile(txtFile, changedFiles, workspaceFolder);
    assert.strictEqual(shouldProcess, false, 'Should not process .txt files');
  });

  test('shouldProcessFile accepts supported file types', async function () {
    this.timeout(20000);
    const tsFile = ctx.createFile('code.ts', 'export const x = 1;');
    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    const shouldProcess = ctx.getObserverInternals().shouldProcessFile(tsFile, changedFiles, workspaceFolder);
    assert.strictEqual(shouldProcess, true, 'Should process .ts files');
  });

  test('handleFileChange filters files not in changed list', async function () {
    this.timeout(20000);
    const changedFile = ctx.createFile('changed.ts', 'export const x = 1;');
    const committedFile = ctx.commitFile('committed.js', 'console.log("committed");', 'Add committed.js');

    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, 'changed.ts');
    ctx.assertFileInChangedList(changedFiles, 'committed.js', false);

    await ctx.triggerFileChange(changedFile);
    await ctx.triggerFileChange(committedFile);
    ctx.assertFileInTracker(changedFile);
    ctx.assertFileInTracker(committedFile, false);
  });

  test('change event removes tracked file when no longer changed', async function () {
    this.timeout(20000);
    const filePath = ctx.createFile('stale-change.ts', 'export const stale = 1;');

    await ctx.triggerFileChange(filePath);
    ctx.assertFileInTracker(filePath);

    ctx.execGit('git add stale-change.ts');
    ctx.execGit('git commit -m "Make stale-change.ts clean"');

    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, 'stale-change.ts', false);

    const observer = ctx.getObserverInternals();
    observer.eventQueue.push({ type: 'change', uri: Uri.file(filePath) });
    await observer.processQueuedEvents();

    ctx.assertFileInTracker(filePath, false);
  });

  test('integration: file modification and revert cycle updates Code Health Monitor', async function () {
    this.timeout(20000);

    const fileName = 'healthy-file.ts';
    const originalContent = 'export function hello() { return "world"; }';
    const filePath = ctx.commitFile(fileName, originalContent, 'Add healthy file');

    let changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, fileName, false);

    const modifiedContent = 'export function hello() { return "modified"; }';
    fs.writeFileSync(filePath, modifiedContent);

    await ctx.triggerFileChange(filePath);
    changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, fileName, true);
    ctx.assertFileInTracker(filePath, true);

    fs.writeFileSync(filePath, originalContent);

    changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, fileName, false);

    const observer = ctx.getObserverInternals();
    observer.eventQueue.push({ type: 'change', uri: Uri.file(filePath) });
    await observer.processQueuedEvents();

    ctx.assertFileInTracker(filePath, false);
  });

  test('getChangedFilesVsBaseline handles files with whitespace in names', async function () {
    this.timeout(20000);
    ctx.createFile('my file.ts', 'console.log("has spaces");');
    ctx.createFile('test file with spaces.js', 'console.log("also has spaces");');

    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    const fileNames = changedFiles.map((f) => path.basename(f));
    assert.ok(fileNames.includes('my file.ts'), 'Should include file with spaces: my file.ts');
    assert.ok(fileNames.includes('test file with spaces.js'), 'Should include file with spaces: test file with spaces.js');
  });

  test('gitignored files are not tracked', async function () {
    this.timeout(20000);
    const gitignorePath = path.join(ctx.testRepoPath, '.gitignore');
    fs.writeFileSync(gitignorePath, '*.ignored\n');

    const ignoredFile = ctx.createFile('secret.ignored', 'export const secret = "hidden";');

    const changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, 'secret.ignored', false);

    await ctx.triggerFileChange(ignoredFile);
    ctx.assertFileInTracker(ignoredFile, false);

    fs.unlinkSync(gitignorePath);
  });

  test('file becomes tracked after gitignore removal', async function () {
    this.timeout(20000);
    const gitignorePath = path.join(ctx.testRepoPath, '.gitignore');
    fs.writeFileSync(gitignorePath, 'config.ts\n');

    const ignoredFile = ctx.createFile('config.ts', 'export const config = { secret: true };');

    let changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, 'config.ts', false);

    await ctx.triggerFileChange(ignoredFile);
    ctx.assertFileInTracker(ignoredFile, false);

    fs.unlinkSync(gitignorePath);

    await new Promise((resolve) => setTimeout(resolve, 100));

    changedFiles = await ctx.gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    ctx.assertFileInChangedList(changedFiles, 'config.ts');

    await ctx.triggerFileChange(ignoredFile);
    ctx.assertFileInTracker(ignoredFile);
  });
});
