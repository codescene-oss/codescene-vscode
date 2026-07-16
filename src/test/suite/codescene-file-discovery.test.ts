import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { discoverCodeHealthRulesFileUris } from '../../git/codescene-file-discovery';
import { setMockFindFilesResults, clearMockFindFilesResults } from '../setup';

function assertNotInGitRepo(dir: string): void {
  let current = dir;
  const root = path.parse(current).root;

  while (current !== root) {
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      throw new Error(`Test directory ${dir} is inside a Git repository at ${current}`);
    }
    current = path.dirname(current);
  }
}

suite('CodeScene File Discovery Test Suite', function () {
  let testDir: string;

  function createCodeHealthRulesFile(relativePath: string): string {
    const fullPath = path.join(testDir, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, '{}');
    return fullPath;
  }

  function gitAdd(filePath: string) {
    const relativePath = path.relative(testDir, filePath);
    execSync(`git add "${relativePath}"`, { cwd: testDir, stdio: 'pipe' });
  }

  function gitCommit(message: string) {
    execSync(`git commit -m "${message}"`, { cwd: testDir, stdio: 'pipe' });
  }

  setup(function () {
    this.timeout(20000);
    const testBaseDir = path.join(os.homedir(), '.codescene-test-data');
    if (!fs.existsSync(testBaseDir)) {
      fs.mkdirSync(testBaseDir, { recursive: true });
    }
    testDir = fs.mkdtempSync(path.join(testBaseDir, 'codescene-file-discovery-test-'));

    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config advice.defaultBranchName false', { cwd: testDir, stdio: 'pipe' });
  });

  teardown(function () {
    this.timeout(20000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const discoveryTestCases = [
    {
      name: 'returns empty array when no files exist',
      files: [],
      tracked: [],
      expectedCount: 0,
    },
    {
      name: 'discovers file at workspace root',
      files: ['.codescene/code-health-rules.json'],
      tracked: ['.codescene/code-health-rules.json'],
      expectedCount: 1,
    },
    {
      name: 'discovers file at depth 1',
      files: ['sub/.codescene/code-health-rules.json'],
      tracked: ['sub/.codescene/code-health-rules.json'],
      expectedCount: 1,
    },
    {
      name: 'discovers file at depth 2',
      files: ['a/b/.codescene/code-health-rules.json'],
      tracked: ['a/b/.codescene/code-health-rules.json'],
      expectedCount: 1,
    },
    {
      name: 'discovers file at depth 3',
      files: ['a/b/c/.codescene/code-health-rules.json'],
      tracked: ['a/b/c/.codescene/code-health-rules.json'],
      expectedCount: 1,
    },
    {
      name: 'discovers multiple files at various depths',
      files: [
        '.codescene/code-health-rules.json',
        'sub/.codescene/code-health-rules.json',
        'a/b/c/.codescene/code-health-rules.json',
      ],
      tracked: [
        '.codescene/code-health-rules.json',
        'sub/.codescene/code-health-rules.json',
        'a/b/c/.codescene/code-health-rules.json',
      ],
      expectedCount: 3,
    },
    {
      name: 'discovers untracked file at workspace root via fs.existsSync',
      files: ['.codescene/code-health-rules.json'],
      tracked: [],
      expectedCount: 1,
    },
  ];

  for (const tc of discoveryTestCases) {
    test(tc.name, async function () {
      this.timeout(10000);

      const createdPaths: string[] = [];
      for (const file of tc.files) {
        createdPaths.push(createCodeHealthRulesFile(file));
      }

      if (tc.tracked.length > 0) {
        for (const file of tc.tracked) {
          gitAdd(path.join(testDir, file));
        }
        gitCommit('Add rules files');
      }

      const uris = await discoverCodeHealthRulesFileUris(testDir, testDir);

      assert.strictEqual(uris.length, tc.expectedCount, `Expected ${tc.expectedCount} files`);

      if (tc.expectedCount > 0) {
        const fsPaths = uris.map((u) => path.normalize(u.fsPath)).sort();
        const expectedPaths = createdPaths.map((p) => path.normalize(p)).sort();
        assert.deepStrictEqual(fsPaths, expectedPaths);
      }
    });
  }

  test('filters out files outside workspace when git root differs', async function () {
    this.timeout(10000);

    const subWorkspace = path.join(testDir, 'workspace');
    fs.mkdirSync(subWorkspace, { recursive: true });

    createCodeHealthRulesFile('.codescene/code-health-rules.json');
    const insideRules = createCodeHealthRulesFile('workspace/.codescene/code-health-rules.json');

    gitAdd(path.join(testDir, '.codescene/code-health-rules.json'));
    gitAdd(path.join(testDir, 'workspace/.codescene/code-health-rules.json'));
    gitCommit('Add rules files');

    const uris = await discoverCodeHealthRulesFileUris(subWorkspace, testDir);

    assert.strictEqual(uris.length, 1);
    assert.strictEqual(path.normalize(uris[0].fsPath), path.normalize(insideRules));
  });

  suite('non-git workspace (uses findFiles fallback)', function () {
    let nonGitTempDir: string;

    setup(function () {
      nonGitTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescene-nongit-test-'));
      assertNotInGitRepo(nonGitTempDir);
    });

    teardown(function () {
      clearMockFindFilesResults();
      if (fs.existsSync(nonGitTempDir)) {
        fs.rmSync(nonGitTempDir, { recursive: true, force: true });
      }
    });

    const nonGitTestCases = [
      {
        name: 'uses findFiles fallback in non-git workspace with files',
        mockResultPaths: ['.codescene/code-health-rules.json', 'sub/.codescene/code-health-rules.json'],
        expectedCount: 2,
      },
      {
        name: 'uses findFiles fallback in non-git workspace with no files',
        mockResultPaths: [],
        expectedCount: 0,
      },
    ];

    for (const tc of nonGitTestCases) {
      test(tc.name, async function () {
        this.timeout(10000);

        const mockResults = tc.mockResultPaths.map((p) => ({ fsPath: path.join(nonGitTempDir, p) }));
        setMockFindFilesResults(mockResults);

        const uris = await discoverCodeHealthRulesFileUris(nonGitTempDir, undefined);

        assert.strictEqual(uris.length, tc.expectedCount);
        if (tc.expectedCount > 0) {
          const fsPaths = uris.map((u) => u.fsPath).sort();
          const expectedPaths = mockResults.map((r) => r.fsPath).sort();
          assert.deepStrictEqual(fsPaths, expectedPaths);
        }
      });
    }
  });
});
