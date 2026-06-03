import * as assert from 'assert';
import * as path from 'path';
import { Uri } from 'vscode';
import {
  activate as activateCodeHealthMonitor,
  deactivate as deactivateCodeHealthMonitor,
  refreshMergeBaseBaselines,
  runGitChangeLister,
} from '../../code-health-monitor/addon';
import { CsExtensionState } from '../../cs-extension-state';
import { DevtoolsAPI } from '../../devtools-api';
import Reviewer from '../../review/reviewer';
import { GitChangeLister } from '../../git/git-change-lister';
import { markGitAsUnavailable, resetGitAvailability } from '../../git/git-detection';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { setMockGitRepositories, clearMockGitRepositories, mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { ensureBinary } from '../integration_helper';

suite('Code Health Monitor Addon Test Suite', () => {
  let mockContext: ReturnType<typeof createMockExtensionContext>;
  const repoRoot = path.join(__dirname, '../../../test-git-repo-addon');

  function createMockRepo(rootPath: string = repoRoot) {
    return {
      rootUri: Uri.file(rootPath),
      state: {
        HEAD: { name: 'main', commit: 'abc123' },
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
    };
  }

  suiteSetup(async function () {
    this.timeout(60000);
    const binaryPath = await ensureBinary();
    mockContext = createMockExtensionContext(repoRoot);
    CsExtensionState.init(mockContext);
    Reviewer.init(mockContext, async () => undefined, () => new Map());
    DevtoolsAPI.init(binaryPath, mockContext);
  });

  setup(() => {
    resetGitAvailability();
    clearMockGitRepositories();
    mockWorkspaceFolders([createMockWorkspaceFolder(repoRoot)]);
  });

  teardown(() => {
    deactivateCodeHealthMonitor();
    resetGitAvailability();
    clearMockGitRepositories();
    restoreDefaultWorkspaceFolders();
  });

  test('refreshMergeBaseBaselines is a no-op when git API is unavailable', () => {
    refreshMergeBaseBaselines();
  });

  test('runGitChangeLister is a no-op before code health monitor activation', async () => {
    await runGitChangeLister();
  });

  test('refreshMergeBaseBaselines updates review baselines for all repositories', () => {
    setMockGitRepositories([createMockRepo()]);
    activateCodeHealthMonitor(mockContext, { getSavedFiles: () => new Set<string>() } as any);

    let setBaselineCalls = 0;
    const originalSetBaseline = Reviewer.instance.setBaseline.bind(Reviewer.instance);
    Reviewer.instance.setBaseline = (fileFilter) => {
      setBaselineCalls += 1;
      return originalSetBaseline(fileFilter);
    };

    refreshMergeBaseBaselines();

    assert.strictEqual(setBaselineCalls, 1);
    Reviewer.instance.setBaseline = originalSetBaseline;
  });

  test('runGitChangeLister invokes lister after activation', async function () {
    this.timeout(20000);
    setMockGitRepositories([createMockRepo()]);
    activateCodeHealthMonitor(mockContext, { getSavedFiles: () => new Set<string>() } as any);

    let startCalled = false;
    const originalStart = GitChangeLister.prototype.start;
    GitChangeLister.prototype.start = async function () {
      startCalled = true;
      return originalStart.call(this);
    };

    await runGitChangeLister();

    assert.strictEqual(startCalled, true);
    GitChangeLister.prototype.start = originalStart;
  });

  test('runGitChangeLister is a no-op when git is unavailable', async () => {
    setMockGitRepositories([createMockRepo()]);
    activateCodeHealthMonitor(mockContext, { getSavedFiles: () => new Set<string>() } as any);
    markGitAsUnavailable();

    let startCalled = false;
    const originalStart = GitChangeLister.prototype.start;
    GitChangeLister.prototype.start = async function () {
      startCalled = true;
      return originalStart.call(this);
    };

    await runGitChangeLister();

    assert.strictEqual(startCalled, false);
    GitChangeLister.prototype.start = originalStart;
  });

  test('deactivate clears git change lister instance', async () => {
    setMockGitRepositories([createMockRepo()]);
    activateCodeHealthMonitor(mockContext, { getSavedFiles: () => new Set<string>() } as any);
    deactivateCodeHealthMonitor();

    let startCalled = false;
    const originalStart = GitChangeLister.prototype.start;
    GitChangeLister.prototype.start = async function () {
      startCalled = true;
      return originalStart.call(this);
    };

    await runGitChangeLister();

    assert.strictEqual(startCalled, false);
    GitChangeLister.prototype.start = originalStart;
  });
});
