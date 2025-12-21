import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { Uri, Disposable, ExtensionContext } from '../mocks/vscode';
import { GitChangeObserver } from '../../git/git-change-observer';
import { MockExecutor } from '../mocks/mock-executor';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { getWorkspaceFolder } from '../../utils';

suite('GitChangeObserver Test Suite', () => {
  const testRepoPath = path.join(__dirname, '../../../test-git-repo-observer');
  const { execSync } = require('child_process');
  let gitChangeObserver: GitChangeObserver;
  let mockExecutor: MockExecutor;
  let mockContext: ExtensionContext;

  const execGit = (args: string) => execSync(args, { cwd: testRepoPath, stdio: 'pipe' });

  const execGitAsync = (args: string) => {
    return new Promise<void>((resolve, reject) => {
      try {
        execSync(args, { cwd: testRepoPath, stdio: 'pipe' });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  };

  const createFile = (filename: string, content: string) => {
    const filePath = path.join(testRepoPath, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  const commitFile = (filename: string, content: string, message: string) => {
    createFile(filename, content);
    execGit(`git add ${filename}`);
    execGit(`git commit -m "${message}"`);
    return path.join(testRepoPath, filename);
  };

  const getObserverInternals = () => gitChangeObserver as any;

  const getTracker = (): Set<string> => getObserverInternals().tracker;

  const triggerFileChange = async (filePath: string) => {
    const observer = getObserverInternals();
    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    await observer.handleFileChange(Uri.file(filePath), changedFiles, workspaceFolder);
  };

  const assertFileInChangedList = (changedFiles: string[], filename: string, shouldExist: boolean = true) => {
    const exists = changedFiles.some(f => f.endsWith(filename));
    assert.strictEqual(exists, shouldExist,
                       shouldExist ? `Should include ${filename}` : `Should not include ${filename}`);
  };

  const assertFileInTracker = (filePath: string, shouldExist: boolean = true) => {
    const tracker = getTracker();
    assert.strictEqual(tracker.has(filePath), shouldExist,
                       shouldExist ? 'File should be in tracker' : 'File should not be in tracker');
  };

  setup(async function() {
    this.timeout(20000);

    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testRepoPath, { recursive: true });

    execGit('git init');
    execGit('git config user.email "test@example.com"');
    execGit('git config user.name "Test User"');
    execGit('git config advice.defaultBranchName false');

    // Set up dummy excludes file to avoid matching anything unintentionally
    const gitInfoDir = path.join(testRepoPath, '.git', 'info');
    fs.mkdirSync(gitInfoDir, { recursive: true });
    const dummyExcludesPath = path.join(gitInfoDir, 'exclude-test');
    fs.writeFileSync(dummyExcludesPath, '# Test excludes file - will not match anything\n__xxxxxxxxxxxxx__\n');
    await execGitAsync(`git config core.excludesfile "${dummyExcludesPath}"`);

    commitFile('README.md', '# Test Repository', 'Initial commit');

    mockWorkspaceFolders([createMockWorkspaceFolder(testRepoPath)]);

    const extensionPath = path.join(__dirname, '../../..');
    mockContext = {
      subscriptions: [] as Disposable[],
      extensionPath: extensionPath,
      extensionUri: Uri.file(extensionPath),
      globalState: {} as any,
      workspaceState: {} as any,
      secrets: {} as any,
      storagePath: testRepoPath,
      globalStoragePath: testRepoPath,
      logPath: testRepoPath,
      extensionMode: 3,
      environmentVariableCollection: {} as any,
      asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
      storageUri: Uri.file(testRepoPath),
      globalStorageUri: Uri.file(testRepoPath),
      logUri: Uri.file(testRepoPath),
      extension: {
        id: 'test-extension',
        extensionUri: Uri.file(extensionPath),
        extensionPath: extensionPath,
        isActive: true,
        packageJSON: {},
        extensionKind: 1,
        exports: {},
        activate: () => Promise.resolve({})
      }
    } as any;

    mockExecutor = new MockExecutor();
    const mockSavedFilesTracker = { getSavedFiles: () => new Set<string>() } as any;
    const mockOpenFilesObserver = { getAllVisibleFileNames: () => new Set<string>() } as any;
    gitChangeObserver = new GitChangeObserver(mockContext, mockExecutor, mockSavedFilesTracker, mockOpenFilesObserver);
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  teardown(() => {
    if (gitChangeObserver) {
      gitChangeObserver.dispose();
    }

    const gitignorePath = path.join(testRepoPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      fs.unlinkSync(gitignorePath);
    }

    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });

  test('getChangedFilesVsBaseline returns empty array for clean repository', async function () {
    this.timeout(20000);
    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assert.strictEqual(changedFiles.length, 0);
  });

  test('getChangedFilesVsBaseline detects new untracked files', async function () {
    this.timeout(20000);
    createFile('test.ts', 'console.log("test");');
    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assertFileInChangedList(changedFiles, 'test.ts');
  });

  test('getChangedFilesVsBaseline detects modified files', async function () {
    this.timeout(20000);
    const testFile = commitFile('index.js', 'console.log("hello");', 'Add index.js');
    fs.writeFileSync(testFile, 'console.log("modified");');
    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assertFileInChangedList(changedFiles, 'index.js');
  });

  test('getChangedFilesVsBaseline detects staged files', async function () {
    this.timeout(20000);
    createFile('script.py', 'print("hello")');
    execGit('git add script.py');
    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assertFileInChangedList(changedFiles, 'script.py');
  });

  test('getChangedFilesVsBaseline combines status and diff changes', async function () {
    this.timeout(20000);
    execGit('git checkout -b feature-branch');
    commitFile('committed.ts', 'export const foo = 1;', 'Add committed.ts');
    createFile('uncommitted.ts', 'export const bar = 2;');

    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assertFileInChangedList(changedFiles, 'committed.ts');
    assertFileInChangedList(changedFiles, 'uncommitted.ts');
  });

  test('tracker tracks added files', async function () {
    this.timeout(20000);
    const newFile = createFile('tracked.ts', 'export const x = 1;');
    gitChangeObserver.start();
    await new Promise(resolve => setTimeout(resolve, 500));
    await triggerFileChange(newFile);
    assertFileInTracker(newFile);
  });

  test('removeFromTracker removes file from tracking', async function () {
    this.timeout(20000);
    const newFile = createFile('removable.ts', 'export const x = 1;');
    gitChangeObserver.start();
    await new Promise(resolve => setTimeout(resolve, 500));
    await triggerFileChange(newFile);
    assertFileInTracker(newFile);
    gitChangeObserver.removeFromTracker(newFile);
    assertFileInTracker(newFile, false);
  });

  test('handleFileDelete removes tracked file', async function () {
    this.timeout(20000);
    const newFile = createFile('deletable.ts', 'export const x = 1;');
    gitChangeObserver.start();
    await new Promise(resolve => setTimeout(resolve, 500));
    await triggerFileChange(newFile);
    assertFileInTracker(newFile);
    fs.unlinkSync(newFile);
    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    await getObserverInternals().handleFileDelete(Uri.file(newFile), changedFiles, workspaceFolder);
    assertFileInTracker(newFile, false);
  });

  test('handleFileDelete handles directory deletion', async function () {
    this.timeout(20000);
    const subDir = path.join(testRepoPath, 'subdir');
    fs.mkdirSync(subDir, { recursive: true });
    const file1 = path.join(subDir, 'file1.ts');
    const file2 = path.join(subDir, 'file2.ts');
    fs.writeFileSync(file1, 'export const a = 1;');
    fs.writeFileSync(file2, 'export const b = 2;');

    gitChangeObserver.start();
    await new Promise(resolve => setTimeout(resolve, 500));
    await triggerFileChange(file1);
    await triggerFileChange(file2);
    assertFileInTracker(file1);
    assertFileInTracker(file2);

    fs.rmSync(subDir, { recursive: true, force: true });
    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    await getObserverInternals().handleFileDelete(Uri.file(subDir), changedFiles, workspaceFolder);
    assertFileInTracker(file1, false);
    assertFileInTracker(file2, false);
  });

  test('shouldProcessFile rejects unsupported file types', async function () {
    this.timeout(20000);
    const txtFile = createFile('notes.txt', 'Some notes');
    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    const shouldProcess = getObserverInternals().shouldProcessFile(txtFile, changedFiles, workspaceFolder);
    assert.strictEqual(shouldProcess, false, 'Should not process .txt files');
  });

  test('shouldProcessFile accepts supported file types', async function () {
    this.timeout(20000);
    const tsFile = createFile('code.ts', 'export const x = 1;');
    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    const shouldProcess = getObserverInternals().shouldProcessFile(tsFile, changedFiles, workspaceFolder);
    assert.strictEqual(shouldProcess, true, 'Should process .ts files');
  });

  test('handleFileChange filters files not in changed list', async function () {
    this.timeout(20000);
    const changedFile = createFile('changed.ts', 'export const x = 1;');
    const committedFile = commitFile('committed.js', 'console.log("committed");', 'Add committed.js');

    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assertFileInChangedList(changedFiles, 'changed.ts');
    assertFileInChangedList(changedFiles, 'committed.js', false);

    await triggerFileChange(changedFile);
    await triggerFileChange(committedFile);
    assertFileInTracker(changedFile);
    assertFileInTracker(committedFile, false);
  });

  test('getChangedFilesVsBaseline handles files with whitespace in names', async function () {
    this.timeout(20000);
    createFile('my file.ts', 'console.log("has spaces");');
    createFile('test file with spaces.js', 'console.log("also has spaces");');

    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    const fileNames = changedFiles.map(f => path.basename(f));
    assert.ok(fileNames.includes('my file.ts'), 'Should include file with spaces: my file.ts');
    assert.ok(fileNames.includes('test file with spaces.js'), 'Should include file with spaces: test file with spaces.js');
  });

  test('gitignored files are not tracked', async function () {
    this.timeout(20000);
    const gitignorePath = path.join(testRepoPath, '.gitignore');
    fs.writeFileSync(gitignorePath, '*.ignored\n');

    const ignoredFile = createFile('secret.ignored', 'export const secret = "hidden";');

    const changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assertFileInChangedList(changedFiles, 'secret.ignored', false);

    await triggerFileChange(ignoredFile);
    assertFileInTracker(ignoredFile, false);

    fs.unlinkSync(gitignorePath);
  });

  test('file becomes tracked after gitignore removal', async function () {
    this.timeout(20000);
    const gitignorePath = path.join(testRepoPath, '.gitignore');
    fs.writeFileSync(gitignorePath, 'config.ts\n');

    const ignoredFile = createFile('config.ts', 'export const config = { secret: true };');

    let changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assertFileInChangedList(changedFiles, 'config.ts', false);

    await triggerFileChange(ignoredFile);
    assertFileInTracker(ignoredFile, false);

    fs.unlinkSync(gitignorePath);

    await new Promise(resolve => setTimeout(resolve, 100));

    changedFiles = await gitChangeObserver.getChangedFilesVsBaseline(getWorkspaceFolder());
    assertFileInChangedList(changedFiles, 'config.ts');

    await triggerFileChange(ignoredFile);
    assertFileInTracker(ignoredFile);
  });

  test('dispose cleans up file watcher', function () {
    this.timeout(20000);
    assert.ok(getObserverInternals().fileWatcher, 'File watcher should exist');
    gitChangeObserver.dispose();
    assert.ok(true, 'Dispose completed without errors');
  });

  test('events are queued instead of processed immediately', async function () {
    this.timeout(20000);
    const file1 = createFile('queued1.ts', 'export const a = 1;');
    const file2 = createFile('queued2.ts', 'export const b = 2;');

    gitChangeObserver.start();
    await new Promise(resolve => setTimeout(resolve, 500));

    const observer = getObserverInternals();
    observer.eventQueue.push({type: 'create', uri: Uri.file(file1)});
    observer.eventQueue.push({type: 'create', uri: Uri.file(file2)});

    assert.strictEqual(observer.eventQueue.length, 2, 'Events should get queued');
    assertFileInTracker(file1, false);
    assertFileInTracker(file2, false);

    await new Promise(resolve => setTimeout(resolve, 1500));

    assert.strictEqual(observer.eventQueue.length, 0, 'Queue should be empty after processing');
    assertFileInTracker(file1);
    assertFileInTracker(file2);
  });

  test('getChangedFilesVsBaseline is called once per batch, not per file', async function () {
    this.timeout(20000);
    const files = [
      createFile('cache1.ts', 'export const a = 1;'),
      createFile('cache2.ts', 'export const b = 2;'),
      createFile('cache3.ts', 'export const c = 3;')
    ];

    gitChangeObserver.start();
    await new Promise(resolve => setTimeout(resolve, 500));

    const observer = getObserverInternals();

    let getChangedFilesCallCount = 0;
    const originalGetChangedFiles = gitChangeObserver.getChangedFilesVsBaseline.bind(gitChangeObserver);
    gitChangeObserver.getChangedFilesVsBaseline = async function(workspaceFolder) {
      getChangedFilesCallCount++;
      return originalGetChangedFiles(workspaceFolder);
    };

    for (const file of files) {
      observer.eventQueue.push({type: 'create', uri: Uri.file(file)});
    }

    assert.strictEqual(getChangedFilesCallCount, 0, "getChangedFilesVsBaseline doesn't get called until the batch gets processed");

    await new Promise(resolve => setTimeout(resolve, 1500));

    assert.strictEqual(getChangedFilesCallCount, 1, 'getChangedFilesVsBaseline should be called once per batch');

    files.forEach(file => assertFileInTracker(file));
  });

  test('empty queue does not trigger unnecessary processing', async function () {
    this.timeout(20000);

    gitChangeObserver.start();
    await new Promise(resolve => setTimeout(resolve, 500));

    let getChangedFilesCallCount = 0;
    const originalGetChangedFiles = gitChangeObserver.getChangedFilesVsBaseline.bind(gitChangeObserver);
    gitChangeObserver.getChangedFilesVsBaseline = async function(workspaceFolder) {
      getChangedFilesCallCount++;
      return originalGetChangedFiles(workspaceFolder);
    };

    await new Promise(resolve => setTimeout(resolve, 5000));

    assert.strictEqual(getChangedFilesCallCount, 0, 'getChangedFilesVsBaseline should not be called for empty queue');
  });

  test('dispose cleans up scheduled executor', function () {
    this.timeout(20000);
    const observer = getObserverInternals();
    assert.ok(observer.scheduledExecutor, 'Scheduled executor should exist');

    gitChangeObserver.dispose();

    // After dispose, the interval should be cleared
    assert.strictEqual(observer.scheduledExecutor.intervalHandle, null, 'Interval should be cleared after dispose');
  });
});
