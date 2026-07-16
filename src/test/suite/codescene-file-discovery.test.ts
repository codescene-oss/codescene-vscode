import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { discoverCodeHealthRulesFileUris } from '../../git/codescene-file-discovery';
import { createTestDir } from '../integration_helper';

suite('CodeScene File Discovery Test Suite', function () {
  const testDir = createTestDir('test-codescene-file-discovery');

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
    execSync(`git add "${relativePath}"`, { cwd: testDir });
  }

  function gitCommit(message: string) {
    execSync(`git commit -m "${message}"`, { cwd: testDir });
  }

  setup(function () {
    this.timeout(20000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    execSync('git config advice.defaultBranchName false', { cwd: testDir });
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
});
