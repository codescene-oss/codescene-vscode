import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { Uri, ExtensionContext } from '../mocks/vscode';
import { GitChangeLister } from '../../git/git-change-lister';
import { MockExecutor } from '../mocks/mock-executor';
import { API } from '../../../types/git';
import { DefaultBranchGate } from '../../git/default-branch-gate';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders, setMockGitRepositories, clearMockGitRepositories } from '../setup';
import { setGitApiForTesting } from '../../code-health-monitor/addon';
import { MockGitAPI } from '../mocks/mock-git-api';
import { CsExtensionState } from '../../cs-extension-state';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { ensureBinary } from '../integration_helper';
import { DevtoolsAPI, DeltaAnalysisEvent } from '../../devtools-api';
import Reviewer from '../../review/reviewer';
import { DeltaAnalysisTreeProvider } from '../../code-health-monitor/delta-analysis-tree-provider';
import { CodeHealthMonitorView } from '../../code-health-monitor/tree-view';
import { FileWithIssues } from '../../code-health-monitor/file-with-issues';

suite('GitChangeLister Test Suite', () => {
  const testRepoPath = path.join(__dirname, '../../../test-git-repo');
  let gitChangeLister: GitChangeLister;
  let mockExecutor: MockExecutor;
  let mockDefaultBranchGate: DefaultBranchGate;

  setup(async function () {
    this.timeout(20000);
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testRepoPath, { recursive: true });

    const { execSync } = require('child_process');
    execSync('git init', { cwd: testRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath });
    execSync('git config user.name "Test User"', { cwd: testRepoPath });
    execSync('git config advice.defaultBranchName false', { cwd: testRepoPath });

    fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Test Repository');
    execSync('git add README.md', { cwd: testRepoPath });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath });

    mockExecutor = new MockExecutor();
    const mockSavedFilesTracker = { getSavedFiles: () => new Set<string>() } as any;
    mockDefaultBranchGate = { shouldSkipBasedOnDefaultBranch: async () => false } as any;
    gitChangeLister = new GitChangeLister(mockExecutor, mockSavedFilesTracker, mockDefaultBranchGate);
  });

  teardown(async function () {
    this.timeout(20000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  test('getAllChangedFiles returns empty set for clean repository', async function () {
    this.timeout(20000);
    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath, '');
    assert.strictEqual(changedFiles.size, 0);
  });

  test('getAllChangedFiles detects new untracked files', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const newFile = path.join(testRepoPath, 'test.ts');
    fs.writeFileSync(newFile, 'console.log("test");');

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath, '');

    assert.ok(changedFiles.size > 0);
    assert.ok(Array.from(changedFiles).some(f => f.endsWith('test.ts')));
  });

  test('getAllChangedFiles detects modified files', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const testFile = path.join(testRepoPath, 'index.js');
    fs.writeFileSync(testFile, 'console.log("hello");');
    execSync('git add index.js', { cwd: testRepoPath });
    execSync('git commit -m "Add index.js"', { cwd: testRepoPath });

    fs.writeFileSync(testFile, 'console.log("modified");');

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath, '');

    assert.ok(changedFiles.size > 0);
    assert.ok(Array.from(changedFiles).some(f => f.endsWith('index.js')));
  });

  test('getAllChangedFiles detects staged files', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const newFile = path.join(testRepoPath, 'script.py');
    fs.writeFileSync(newFile, 'print("hello")');
    execSync('git add script.py', { cwd: testRepoPath });

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath, '');

    assert.ok(changedFiles.size > 0);
    assert.ok(Array.from(changedFiles).some(f => f.endsWith('script.py')));
  });

  test('getAllChangedFiles filters unsupported file types', async function () {
    this.timeout(20000);
    const txtFile = path.join(testRepoPath, 'notes.txt');
    const mdFile = path.join(testRepoPath, 'docs.md');
    const tsFile = path.join(testRepoPath, 'code.ts');
    fs.writeFileSync(txtFile, 'Some notes');
    fs.writeFileSync(mdFile, '# Documentation');
    fs.writeFileSync(tsFile, 'export const x = 1;');

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath, '');
    const fileNames = Array.from(changedFiles).map(f => path.basename(f));

    assert.strictEqual(changedFiles.size, 1, 'Should only include supported file type');
    assert.ok(fileNames.includes('code.ts'), 'Should include .ts file');
  });

  test('getAllChangedFiles detects renamed files', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const originalFile = path.join(testRepoPath, 'original.js');
    fs.writeFileSync(originalFile, 'console.log("test");');
    execSync('git add original.js', { cwd: testRepoPath });
    execSync('git commit -m "Add original.js"', { cwd: testRepoPath });

    const renamedFile = path.join(testRepoPath, 'renamed.js');
    fs.renameSync(originalFile, renamedFile);
    execSync('git add -A', { cwd: testRepoPath });

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath, '');

    assert.ok(changedFiles.size > 0);
    assert.ok(Array.from(changedFiles).some(f => f.endsWith('renamed.js')));
  });

  test('getAllChangedFiles combines status and diff changes', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    execSync('git checkout -b feature-branch', { cwd: testRepoPath, stdio: 'pipe' });

    const committedFile = path.join(testRepoPath, 'committed.ts');
    fs.writeFileSync(committedFile, 'export const foo = 1;');
    execSync('git add committed.ts', { cwd: testRepoPath });
    execSync('git commit -m "Add committed.ts"', { cwd: testRepoPath });

    const uncommittedFile = path.join(testRepoPath, 'uncommitted.ts');
    fs.writeFileSync(uncommittedFile, 'export const bar = 2;');

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath, '');

    const fileNames = Array.from(changedFiles).map(f => path.basename(f));
    assert.ok(fileNames.includes('uncommitted.ts'), 'Should include uncommitted file');
  });

  test('getAllChangedFiles handles files with whitespace in names', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const fileWithSpaces = path.join(testRepoPath, 'my file.ts');
    const anotherFileWithSpaces = path.join(testRepoPath, 'test file with spaces.js');
    fs.writeFileSync(fileWithSpaces, 'console.log("has spaces");');
    fs.writeFileSync(anotherFileWithSpaces, 'console.log("also has spaces");');

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath, '');

    const fileNames = Array.from(changedFiles).map(f => path.basename(f));
    assert.ok(fileNames.includes('my file.ts'), 'Should include file with spaces: my file.ts');
    assert.ok(fileNames.includes('test file with spaces.js'), 'Should include file with spaces: test file with spaces.js');
  });

  suite('DefaultBranchGate integration', () => {
    test('getAllChangedFiles still works when gate returns false', async function () {
      this.timeout(20000);
      const newFile = path.join(testRepoPath, 'test.ts');
      fs.writeFileSync(newFile, 'console.log("test");');

      const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath, '');
      assert.ok(Array.from(changedFiles).some(f => f.endsWith('test.ts')));
    });

    [
      { gateReturns: true,  expectGetAllChangedFilesCalled: false, description: 'skips review when gate returns true' },
      { gateReturns: false, expectGetAllChangedFilesCalled: true,  description: 'proceeds with review when gate returns false' },
    ].forEach(({ gateReturns, expectGetAllChangedFilesCalled, description }) => {
      test(`start ${description}`, async function () {
        this.timeout(20000);

        const mockRepo = {
          rootUri: Uri.file(testRepoPath),
          state: {
            HEAD: { name: 'main', commit: 'abc123' },
            refs: [],
            remotes: [],
            submodules: [],
            onDidChange: () => ({ dispose: () => {} }),
          },
        };

        const mockGitApi = new MockGitAPI();
        mockGitApi.repositories = [mockRepo];
        setGitApiForTesting(mockGitApi as any);

        const mockContext = createMockExtensionContext(testRepoPath);
        if (!CsExtensionState.hasInstance) {
          CsExtensionState.init(mockContext);
        }

        mockWorkspaceFolders([createMockWorkspaceFolder(testRepoPath)]);
        setMockGitRepositories([mockRepo]);

        const skipGate = { shouldSkipBasedOnDefaultBranch: async () => gateReturns } as any;
        const mockSavedFilesTracker = { getSavedFiles: () => new Set<string>() } as any;
        const skipLister = new GitChangeLister(mockExecutor, mockSavedFilesTracker, skipGate);

        let getAllChangedFilesCalled = false;
        const originalGetAllChangedFiles = skipLister.getAllChangedFiles.bind(skipLister);
        skipLister.getAllChangedFiles = async function (...args) {
          getAllChangedFilesCalled = true;
          return originalGetAllChangedFiles(...args);
        };

        await skipLister.start();

        assert.strictEqual(getAllChangedFilesCalled, expectGetAllChangedFilesCalled);

        setGitApiForTesting(undefined);
        restoreDefaultWorkspaceFolders();
        clearMockGitRepositories();
      });
    });
  });

  suite('DeltaAnalysisTreeProvider integration', () => {
    const integrationRepoPath = path.join(__dirname, '../../../test-git-repo-integration');
    let treeProvider: DeltaAnalysisTreeProvider;
    let deltaSubscription: { dispose: () => void };

    suiteSetup(async function () {
      this.timeout(60000);
      const binaryPath = await ensureBinary();
      const mockContext = createMockExtensionContext(integrationRepoPath);
      if (!CsExtensionState.hasInstance) {
        CsExtensionState.init(mockContext);
      }
      Reviewer.init(mockContext, () => new Map());
      DevtoolsAPI.init(binaryPath, mockContext, async () => false);
    });

    setup(async function () {
      this.timeout(20000);

      if (deltaSubscription) {
        deltaSubscription.dispose();
      }

      if (fs.existsSync(integrationRepoPath)) {
        fs.rmSync(integrationRepoPath, { recursive: true, force: true });
      }
      fs.mkdirSync(integrationRepoPath, { recursive: true });

      const { execSync } = require('child_process');
      execSync('git init', { cwd: integrationRepoPath });
      execSync('git config user.email "test@example.com"', { cwd: integrationRepoPath });
      execSync('git config user.name "Test User"', { cwd: integrationRepoPath });
      execSync('git config advice.defaultBranchName false', { cwd: integrationRepoPath });

      fs.writeFileSync(path.join(integrationRepoPath, 'README.md'), '# Test Repository');
      execSync('git add README.md', { cwd: integrationRepoPath });
      execSync('git commit -m "Initial commit"', { cwd: integrationRepoPath });

      treeProvider = new DeltaAnalysisTreeProvider();
      deltaSubscription = DevtoolsAPI.onDidDeltaAnalysisComplete((e: DeltaAnalysisEvent) => {
        if (e.updateMonitor) {
          treeProvider.syncTree(e);
        }
      });
    });

    teardown(async function () {
      this.timeout(20000);
      deltaSubscription?.dispose();
      treeProvider.clearTree();
      Reviewer.instance.clearCache();
      setGitApiForTesting(undefined);
      restoreDefaultWorkspaceFolders();
      clearMockGitRepositories();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (fs.existsSync(integrationRepoPath)) {
        fs.rmSync(integrationRepoPath, { recursive: true, force: true });
      }
    });

    const testCases = [
      {
        name: 'degradation via nested conditionals',
        baseCode: `function process(a: number): number {\n  return a + 1;\n}\n`,
        modifiedCode: `function process(a: number, b: number, c: number, d: number, e: number, f: number): number {
  if (a > 0) {
    if (b > 0) {
      if (c > 0) {
        if (d > 0) {
          if (e > 0) {
            return a + b + c + d + e + f;
          }
        }
      }
    }
  }
  return 0;
}
`,
        expectScoreDirection: 'negative' as const,
      },
      {
        name: 'degradation via deep nesting and complexity',
        baseCode: `function simple(): number {\n  return 42;\n}\n`,
        modifiedCode: `function complex(a: number, b: number, c: number): number {
  if (a > 0) {
    if (b > 0) {
      if (c > 0) {
        if (a + b > 10) {
          if (b + c > 10) {
            return a + b + c;
          }
        }
      }
    }
  }
  return 0;
}
`,
        expectScoreDirection: 'negative' as const,
      },
      {
        name: 'degradation via function arguments',
        baseCode: `function calc(a: number): number {\n  return a * 2;\n}\n`,
        modifiedCode: `function calc(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number {
  return a + b + c + d + e + f + g + h;
}
`,
        expectScoreDirection: 'negative' as const,
      },
    ];

    testCases.forEach(({ name, baseCode, modifiedCode, expectScoreDirection }) => {
      test(`detects ${name}`, async function () {
        this.timeout(60000);
        const { execSync } = require('child_process');

        const testFile = path.join(integrationRepoPath, 'code.ts');

        if (baseCode !== null) {
          fs.writeFileSync(testFile, baseCode);
          execSync('git add code.ts', { cwd: integrationRepoPath });
          execSync('git commit -m "Add baseline"', { cwd: integrationRepoPath });
        }

        const baselineCommit = execSync('git rev-parse HEAD', { cwd: integrationRepoPath, encoding: 'utf-8' }).trim();

        fs.writeFileSync(testFile, modifiedCode);

        const mockRepo = {
          rootUri: Uri.file(integrationRepoPath),
          state: {
            HEAD: { name: 'master', commit: baselineCommit },
            refs: [],
            remotes: [],
            submodules: [],
            onDidChange: () => ({ dispose: () => {} }),
          },
        };

        const mockGitApi = new MockGitAPI();
        mockGitApi.repositories = [mockRepo];
        setGitApiForTesting(mockGitApi as any);

        mockWorkspaceFolders([createMockWorkspaceFolder(integrationRepoPath)]);
        setMockGitRepositories([mockRepo]);

        const mockSavedFilesTracker = { getSavedFiles: () => new Set<string>() } as any;
        const mockDefaultBranchGate = { shouldSkipBasedOnDefaultBranch: async () => false } as any;
        const lister = new GitChangeLister(new MockExecutor(), mockSavedFilesTracker, mockDefaultBranchGate);

        await lister.start();

        await new Promise((resolve) => setTimeout(resolve, 5000));

        assert.ok(treeProvider.fileIssueMap.size > 0, `Expected fileIssueMap to have entries, but it was empty`);

        const fileEntry = treeProvider.fileIssueMap.get(testFile);
        assert.ok(fileEntry, `Expected fileIssueMap to contain entry for ${testFile}`);

        if (expectScoreDirection === 'negative') {
          assert.ok(fileEntry.scoreChange < 0, `Expected negative score change (degradation), got ${fileEntry.scoreChange}`);
        } else if (expectScoreDirection === 'positive') {
          assert.ok(fileEntry.scoreChange > 0, `Expected positive score change (improvement), got ${fileEntry.scoreChange}`);
        } else {
          assert.ok(Math.abs(fileEntry.scoreChange) < 0.5, `Expected near-zero score change, got ${fileEntry.scoreChange}`);
        }
      });
    });
  });

  suite('removeStaleFiles', () => {
    let codeHealthMonitorView: CodeHealthMonitorView;
    const mockDocument = (filePath: string) => ({
      uri: Uri.file(filePath),
      fileName: filePath,
    } as any);

    const mockDeltaResult = {
      'old-score': 9.0,
      'new-score': 8.0,
      'score-change': -1.0,
      'file-level-findings': [],
      'function-level-findings': [],
    };

    suiteSetup(() => {
      const mockContext = createMockExtensionContext(testRepoPath);
      if (!CsExtensionState.hasInstance) {
        CsExtensionState.init(mockContext);
      }
    });

    setup(() => {
      const mockContext = createMockExtensionContext(testRepoPath);
      codeHealthMonitorView = new CodeHealthMonitorView(mockContext);
    });

    teardown(() => {
      codeHealthMonitorView.getFileIssueMap().clear();
      codeHealthMonitorView.dispose();
    });

    function addFileToMap(filePath: string) {
      const doc = mockDocument(filePath);
      const fileWithIssues = new FileWithIssues(mockDeltaResult, doc);
      codeHealthMonitorView.getFileIssueMap().set(filePath, fileWithIssues);
    }

    const testCases = [
      {
        name: 'empty fileIssueMap, empty changedFiles, empty visibleFiles - no changes',
        initialFiles: [] as string[],
        changedFiles: [] as string[],
        visibleFiles: [] as string[],
        expectedFiles: [] as string[],
      },
      {
        name: 'empty fileIssueMap, has changedFiles, empty visibleFiles - no changes',
        initialFiles: [],
        changedFiles: ['/workspace/file1.ts'],
        visibleFiles: [],
        expectedFiles: [],
      },
      {
        name: 'has files A,B in map, changedFiles has A,B - keeps A,B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        visibleFiles: [],
        expectedFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
      },
      {
        name: 'has files A,B in map, changedFiles has only A - removes B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: ['/workspace/fileA.ts'],
        visibleFiles: [],
        expectedFiles: ['/workspace/fileA.ts'],
      },
      {
        name: 'has files A,B in map, changedFiles empty, visibleFiles has A - removes B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: [],
        visibleFiles: ['/workspace/fileA.ts'],
        expectedFiles: ['/workspace/fileA.ts'],
      },
      {
        name: 'has files A,B in map, changedFiles has B, visibleFiles has A - keeps A,B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: ['/workspace/fileB.ts'],
        visibleFiles: ['/workspace/fileA.ts'],
        expectedFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
      },
      {
        name: 'has files A,B in map, changedFiles empty, visibleFiles empty - removes A,B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: [],
        visibleFiles: [],
        expectedFiles: [],
      },
      {
        name: 'has files A,B,C in map, changedFiles has A, visibleFiles has B - removes C',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts', '/workspace/fileC.ts'],
        changedFiles: ['/workspace/fileA.ts'],
        visibleFiles: ['/workspace/fileB.ts'],
        expectedFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
      },
    ];

    testCases.forEach(({ name, initialFiles, changedFiles, visibleFiles, expectedFiles }) => {
      test(name, () => {
        initialFiles.forEach(addFileToMap);

        codeHealthMonitorView.removeStaleFiles(new Set(changedFiles), new Set(visibleFiles));

        const fileIssueMap = codeHealthMonitorView.getFileIssueMap();
        assert.strictEqual(fileIssueMap.size, expectedFiles.length);
        expectedFiles.forEach(file => assert.ok(fileIssueMap.has(file), `Expected ${file} to be in map`));
      });
    });

    const pathNormalizationCases = [
      {
        name: 'matches paths with same separators',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace/src/file.ts',
      },
      {
        name: 'matches paths with redundant slashes',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace//src/file.ts',
      },
      {
        name: 'matches paths with dot segments',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace/src/./file.ts',
      },
    ];

    pathNormalizationCases.forEach(({ name, mapPath, changedPath }) => {
      test(`path normalization: ${name}`, () => {
        addFileToMap(mapPath);

        codeHealthMonitorView.removeStaleFiles(new Set([changedPath]), new Set());

        const fileIssueMap = codeHealthMonitorView.getFileIssueMap();
        assert.strictEqual(fileIssueMap.size, 1, `Expected file to be kept when matching via ${changedPath}`);
      });
    });
  });
});
