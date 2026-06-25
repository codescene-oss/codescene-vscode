import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Uri, Disposable, ExtensionContext } from '../mocks/vscode';
import { GitChangeObserver } from '../../git/git-change-observer';
import { WorkspaceFileWatcher } from '../../git/workspace-file-watcher';
import { MockExecutor } from '../mocks/mock-executor';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { getWorkspaceFolder } from '../../utils';

export const GIT_CHANGE_OBSERVER_TEST_REPO = path.join(__dirname, '../../../test-git-repo-observer');

export class GitChangeObserverTestContext {
  gitChangeObserver!: GitChangeObserver;
  mockExecutor!: MockExecutor;
  mockContext!: ExtensionContext;

  private readonly execSync = require('child_process').execSync;

  execGit(args: string): void {
    this.execSync(args, { cwd: GIT_CHANGE_OBSERVER_TEST_REPO, stdio: 'pipe' });
  }

  async execGitAsync(args: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      try {
        this.execSync(args, { cwd: GIT_CHANGE_OBSERVER_TEST_REPO, stdio: 'pipe' });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  createFile(filename: string, content: string): string {
    const filePath = path.join(GIT_CHANGE_OBSERVER_TEST_REPO, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  commitFile(filename: string, content: string, message: string): string {
    this.createFile(filename, content);
    this.execGit(`git add ${filename}`);
    this.execGit(`git commit -m "${message}"`);
    return path.join(GIT_CHANGE_OBSERVER_TEST_REPO, filename);
  }

  getObserverInternals(): any {
    return this.gitChangeObserver as any;
  }

  getTracker(): Set<string> {
    return this.getObserverInternals().tracker;
  }

  async triggerFileChange(filePath: string): Promise<void> {
    const observer = this.getObserverInternals();
    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await this.gitChangeObserver.getChangedFilesVsBaseline(workspaceFolder);
    await observer.handleFileChange(Uri.file(filePath), changedFiles, workspaceFolder);
  }

  assertFileInChangedList(changedFiles: string[], filename: string, shouldExist: boolean = true): void {
    const exists = changedFiles.some((f) => f.endsWith(filename));
    assert.strictEqual(exists, shouldExist, shouldExist ? `Should include ${filename}` : `Should not include ${filename}`);
  }

  assertFileInTracker(filePath: string, shouldExist: boolean = true): void {
    const tracker = this.getTracker();
    assert.strictEqual(tracker.has(filePath), shouldExist, shouldExist ? 'File should be in tracker' : 'File should not be in tracker');
  }

  async setup(): Promise<void> {
    if (fs.existsSync(GIT_CHANGE_OBSERVER_TEST_REPO)) {
      fs.rmSync(GIT_CHANGE_OBSERVER_TEST_REPO, { recursive: true, force: true });
    }
    fs.mkdirSync(GIT_CHANGE_OBSERVER_TEST_REPO, { recursive: true });

    this.execGit('git init');
    this.execGit('git config user.email "test@example.com"');
    this.execGit('git config user.name "Test User"');
    this.execGit('git config advice.defaultBranchName false');

    const gitInfoDir = path.join(GIT_CHANGE_OBSERVER_TEST_REPO, '.git', 'info');
    fs.mkdirSync(gitInfoDir, { recursive: true });
    const dummyExcludesPath = path.join(gitInfoDir, 'exclude-test');
    fs.writeFileSync(dummyExcludesPath, '# Test excludes file - will not match anything\n__xxxxxxxxxxxxx__\n');
    await this.execGitAsync(`git config core.excludesfile "${dummyExcludesPath}"`);

    this.commitFile('README.md', '# Test Repository', 'Initial commit');

    mockWorkspaceFolders([createMockWorkspaceFolder(GIT_CHANGE_OBSERVER_TEST_REPO)]);

    const extensionPath = path.join(__dirname, '../../..');
    this.mockContext = {
      subscriptions: [] as Disposable[],
      extensionPath,
      extensionUri: Uri.file(extensionPath),
      globalState: {} as any,
      workspaceState: {} as any,
      secrets: {} as any,
      storagePath: GIT_CHANGE_OBSERVER_TEST_REPO,
      globalStoragePath: GIT_CHANGE_OBSERVER_TEST_REPO,
      logPath: GIT_CHANGE_OBSERVER_TEST_REPO,
      extensionMode: 3,
      environmentVariableCollection: {} as any,
      asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
      storageUri: Uri.file(GIT_CHANGE_OBSERVER_TEST_REPO),
      globalStorageUri: Uri.file(GIT_CHANGE_OBSERVER_TEST_REPO),
      logUri: Uri.file(GIT_CHANGE_OBSERVER_TEST_REPO),
      extension: {
        id: 'test-extension',
        extensionUri: Uri.file(extensionPath),
        extensionPath,
        isActive: true,
        packageJSON: {},
        extensionKind: 1,
        exports: {},
        activate: () => Promise.resolve({}),
      },
    } as any;

    this.mockExecutor = new MockExecutor();
    const mockSavedFilesTracker = { getSavedFiles: () => new Set<string>() } as any;
    const mockOpenFilesObserver = { getAllVisibleFileNames: () => new Set<string>() } as any;
    WorkspaceFileWatcher.init(this.mockContext);
    this.gitChangeObserver = new GitChangeObserver(this.mockContext, this.mockExecutor, mockSavedFilesTracker, mockOpenFilesObserver);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  teardown(): void {
    if (this.gitChangeObserver) {
      this.gitChangeObserver.dispose();
    }
    WorkspaceFileWatcher.disposeShared();

    const gitignorePath = path.join(GIT_CHANGE_OBSERVER_TEST_REPO, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      fs.unlinkSync(gitignorePath);
    }

    if (fs.existsSync(GIT_CHANGE_OBSERVER_TEST_REPO)) {
      fs.rmSync(GIT_CHANGE_OBSERVER_TEST_REPO, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  }
}
