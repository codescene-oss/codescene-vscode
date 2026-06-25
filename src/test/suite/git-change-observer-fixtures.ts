import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Uri, ExtensionContext } from '../mocks/vscode';
import { GitChangeObserver } from '../../git/git-change-observer';
import { WorkspaceFileWatcher } from '../../git/workspace-file-watcher';
import {
  bindGitApiForTests,
  deactivate as deactivateCodeHealthMonitor,
} from '../../code-health-monitor/addon';
import { CsExtensionState } from '../../cs-extension-state';
import Reviewer from '../../review/reviewer';
import { MockExecutor } from '../mocks/mock-executor';
import {
  mockWorkspaceFolders,
  createMockWorkspaceFolder,
  restoreDefaultWorkspaceFolders,
  setMockGitRepositories,
  clearMockGitRepositories,
} from '../setup';
import { getWorkspaceFolder } from '../../utils';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { resetGitAvailability } from '../../git/git-detection';
import { gitExecutor } from '../../git-utils';

export class GitChangeObserverTestContext {
  testRepoPath!: string;
  gitChangeObserver!: GitChangeObserver;
  mockExecutor!: MockExecutor;
  mockContext!: ExtensionContext;

  private readonly execSync = require('child_process').execSync;

  execGit(args: string, updateMock = true): void {
    this.execSync(args, { cwd: this.testRepoPath, stdio: 'pipe' });
    if (updateMock) {
      this.updateMockGitRepository();
    }
  }

  async execGitAsync(args: string, updateMock = true): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      try {
        this.execSync(args, { cwd: this.testRepoPath, stdio: 'pipe' });
        if (updateMock) {
          this.updateMockGitRepository();
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  createFile(filename: string, content: string): string {
    const filePath = path.join(this.testRepoPath, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  commitFile(filename: string, content: string, message: string): string {
    this.createFile(filename, content);
    this.execGit(`git add ${filename}`);
    this.execGit(`git commit -m "${message}"`);
    return path.join(this.testRepoPath, filename);
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
    const exists = changedFiles.some((f) => path.normalize(f).endsWith(filename));
    assert.strictEqual(exists, shouldExist, shouldExist ? `Should include ${filename}` : `Should not include ${filename}`);
  }

  assertFileInTracker(filePath: string, shouldExist: boolean = true): void {
    const tracker = this.getTracker();
    assert.strictEqual(tracker.has(filePath), shouldExist, shouldExist ? 'File should be in tracker' : 'File should not be in tracker');
  }

  async setup(): Promise<void> {
    resetGitAvailability();

    const testBaseDir = path.join(os.homedir(), '.codescene-test-data');
    if (!fs.existsSync(testBaseDir)) {
      fs.mkdirSync(testBaseDir, { recursive: true });
    }
    this.testRepoPath = fs.mkdtempSync(path.join(testBaseDir, 'git-change-observer-test-'));

    this.execSync('git init', { cwd: this.testRepoPath, stdio: 'pipe' });
    this.execSync('git config user.email "test@example.com"', { cwd: this.testRepoPath, stdio: 'pipe' });
    this.execSync('git config user.name "Test User"', { cwd: this.testRepoPath, stdio: 'pipe' });
    this.execSync('git config advice.defaultBranchName false', { cwd: this.testRepoPath, stdio: 'pipe' });

    const gitInfoDir = path.join(this.testRepoPath, '.git', 'info');
    fs.mkdirSync(gitInfoDir, { recursive: true });
    const dummyExcludesPath = path.join(gitInfoDir, 'exclude-test');
    fs.writeFileSync(dummyExcludesPath, '# Test excludes file - will not match anything\n__xxxxxxxxxxxxx__\n');
    await this.execGitAsync(`git config core.excludesfile "${dummyExcludesPath}"`, false);

    this.commitFile('README.md', '# Test Repository', 'Initial commit');

    const extensionPath = path.join(__dirname, '../../..');
    this.mockContext = createMockExtensionContext(this.testRepoPath) as ExtensionContext;
    this.mockContext.extension = {
      id: 'test-extension',
      extensionUri: Uri.file(extensionPath),
      extensionPath,
      isActive: true,
      packageJSON: {},
      extensionKind: 1,
      exports: {},
      activate: () => Promise.resolve({}),
    } as any;

    mockWorkspaceFolders([createMockWorkspaceFolder(this.testRepoPath)]);

    if (!CsExtensionState.hasInstance) {
      CsExtensionState.init(this.mockContext);
      Reviewer.init(this.mockContext, async () => undefined, () => new Map());
    }

    this.mockExecutor = new MockExecutor();
    const mockSavedFilesTracker = { getSavedFiles: () => new Set<string>() } as any;
    const mockOpenFilesObserver = { getAllVisibleFileNames: () => new Set<string>() } as any;

    this.updateMockGitRepository();
    bindGitApiForTests();

    WorkspaceFileWatcher.init(this.mockContext);
    this.gitChangeObserver = new GitChangeObserver(this.mockContext, this.mockExecutor, mockSavedFilesTracker, mockOpenFilesObserver);
    await this.gitChangeObserver.waitForInitialTrackerSeed();
  }

  async teardown(): Promise<void> {
    if (this.gitChangeObserver) {
      this.gitChangeObserver.dispose();
    }
    gitExecutor.abortAllTasks();
    await new Promise((resolve) => setTimeout(resolve, 200));
    WorkspaceFileWatcher.disposeShared();
    deactivateCodeHealthMonitor();
    clearMockGitRepositories();
    resetGitAvailability();

    if (this.testRepoPath && fs.existsSync(this.testRepoPath)) {
      try {
        fs.rmSync(this.testRepoPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      } catch (error: any) {
        if (error?.code !== 'EBUSY') {
          throw error;
        }
      }
    }

    restoreDefaultWorkspaceFolders();
  }

  private updateMockGitRepository(): void {
    let headCommit: string;
    try {
      headCommit = this.execSync('git rev-parse HEAD', { cwd: this.testRepoPath, encoding: 'utf8' }).trim();
    } catch {
      return;
    }

    const branch =
      this.execSync('git branch --show-current', { cwd: this.testRepoPath, encoding: 'utf8' }).trim() || 'main';

    setMockGitRepositories([
      {
        rootUri: Uri.file(this.testRepoPath),
        state: {
          HEAD: { name: branch, commit: headCommit },
          refs: [],
          remotes: [],
          submodules: [],
          rebaseCommit: undefined,
          mergeChanges: [],
          indexChanges: [],
          workingTreeChanges: [],
          untrackedChanges: [],
          onDidChange: () => ({ dispose: () => {} }),
        },
      },
    ]);
  }
}
