import * as assert from 'assert';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { DefaultBranchGate } from '../../git/default-branch-gate';
import { CODE_SCENE_DIR, CONFIG_FILE_NAME } from '../../git/codescene-repo-config';
import { clearMainBranchCandidatesCache } from '../../git-utils';
import { Repository, RepositoryState, Branch, RepositoryUIState } from '../../../types/git';

suite('DefaultBranchGate Test Suite', () => {
  const testRepoBasePath = path.join(__dirname, '../../../test-git-repo-default-branch-gate');
  let testRepoPath: string;
  let testCounter = 0;

  setup(function () {
    this.timeout(20000);

    testCounter++;
    testRepoPath = `${testRepoBasePath}-${testCounter}`;

    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testRepoPath, { recursive: true });

    execSync('git init', { cwd: testRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath });
    execSync('git config user.name "Test User"', { cwd: testRepoPath });
    execSync('git config advice.defaultBranchName false', { cwd: testRepoPath });
  });

  teardown(function () {
    this.timeout(20000);
    const parentDir = path.dirname(testRepoBasePath);
    if (fs.existsSync(parentDir)) {
      const files = fs.readdirSync(parentDir);
      files.forEach((file) => {
        if (file.startsWith(path.basename(testRepoBasePath))) {
          const fullPath = path.join(parentDir, file);
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        }
      });
    }
  });

  function createMockRepository(
    rootPath: string,
    branchName: string | undefined,
    commitSha: string | undefined
  ): Repository {
    const head: Branch | undefined = branchName
      ? { type: 0, name: branchName, commit: commitSha }
      : undefined;

    return {
      rootUri: Uri.file(rootPath),
      state: {
        HEAD: head,
        refs: [],
        remotes: [],
        submodules: [],
        rebaseCommit: undefined,
        mergeChanges: [],
        indexChanges: [],
        workingTreeChanges: [],
        untrackedChanges: [],
        onDidChange: (() => {}) as any,
      } as RepositoryState,
      ui: {} as RepositoryUIState,
      inputBox: {} as any,
      onDidCommit: (() => {}) as any,
    } as Repository;
  }

  function commitFile(filename: string, content: string, message: string): void {
    fs.writeFileSync(path.join(testRepoPath, filename), content);
    execSync('git add .', { cwd: testRepoPath });
    execSync(`git commit -m "${message}"`, { cwd: testRepoPath });
  }

  function getHeadCommit(): string {
    return execSync('git rev-parse HEAD', { cwd: testRepoPath }).toString().trim();
  }

  function setupOriginHead(defaultBranch: string): void {
    const branchSha = execSync(`git rev-parse ${defaultBranch}`, { cwd: testRepoPath }).toString().trim();
    execSync(`git update-ref refs/remotes/origin/${defaultBranch} ${branchSha}`, {
      cwd: testRepoPath,
      stdio: 'pipe',
    });
    execSync(`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/${defaultBranch}`, {
      cwd: testRepoPath,
      stdio: 'pipe',
    });
  }

  function writeBaselineConfig(branch: string): void {
    const codesceneDir = path.join(testRepoPath, CODE_SCENE_DIR);
    fs.mkdirSync(codesceneDir, { recursive: true });
    fs.writeFileSync(
      path.join(codesceneDir, CONFIG_FILE_NAME),
      JSON.stringify({ baseline_branch: branch })
    );
    clearMainBranchCandidatesCache(testRepoPath);
  }

  suite('shouldSkipBasedOnDefaultBranch', () => {
    const testCases = [
      {
        name: 'returns true when current branch equals default branch',
        setup: () => {
          commitFile('README.md', '# Test', 'Initial commit');
          execSync('git branch -M main', { cwd: testRepoPath, stdio: 'pipe' });
          setupOriginHead('main');
        },
        currentBranch: 'main',
        expected: true,
      },
      {
        name: 'returns false when current branch differs from default branch',
        setup: () => {
          commitFile('README.md', '# Test', 'Initial commit');
          execSync('git branch -M main', { cwd: testRepoPath, stdio: 'pipe' });
          setupOriginHead('main');
          execSync('git checkout -b feature', { cwd: testRepoPath, stdio: 'pipe' });
        },
        currentBranch: 'feature',
        expected: false,
      },
      {
        name: 'returns false when current branch is undefined',
        setup: () => {
          commitFile('README.md', '# Test', 'Initial commit');
          execSync('git branch -M main', { cwd: testRepoPath, stdio: 'pipe' });
          setupOriginHead('main');
        },
        currentBranch: undefined,
        expected: false,
      },
      {
        name: 'returns false when default branch is undefined',
        setup: () => {
          commitFile('README.md', '# Test', 'Initial commit');
        },
        currentBranch: 'main',
        expected: false,
      },
      {
        name: 'returns false when current branch is empty string',
        setup: () => {
          commitFile('README.md', '# Test', 'Initial commit');
          execSync('git branch -M main', { cwd: testRepoPath, stdio: 'pipe' });
          setupOriginHead('main');
        },
        currentBranch: '',
        expected: false,
      },
      {
        name: 'comparison is case-insensitive',
        setup: () => {
          commitFile('README.md', '# Test', 'Initial commit');
          execSync('git branch -M main', { cwd: testRepoPath, stdio: 'pipe' });
          setupOriginHead('main');
        },
        currentBranch: 'MAIN',
        expected: true,
      },
      {
        name: 'uses baseline_branch from config when available',
        setup: () => {
          commitFile('README.md', '# Test', 'Initial commit');
          execSync('git branch -M develop', { cwd: testRepoPath, stdio: 'pipe' });
          writeBaselineConfig('develop');
        },
        currentBranch: 'develop',
        expected: true,
      },
    ];

    for (const tc of testCases) {
      test(tc.name, async function () {
        this.timeout(20000);
        tc.setup();

        const gate = new DefaultBranchGate(testRepoPath);
        const repo = createMockRepository(testRepoPath, tc.currentBranch, getHeadCommit());

        const shouldSkip = await gate.shouldSkipBasedOnDefaultBranch(repo);
        assert.strictEqual(shouldSkip, tc.expected);
      });
    }

    test('current branch is computed fresh each call', async function () {
      this.timeout(20000);
      commitFile('README.md', '# Test', 'Initial commit');
      execSync('git branch -M main', { cwd: testRepoPath, stdio: 'pipe' });
      setupOriginHead('main');

      const gate = new DefaultBranchGate(testRepoPath);

      const repoOnMain = createMockRepository(testRepoPath, 'main', getHeadCommit());
      const shouldSkip1 = await gate.shouldSkipBasedOnDefaultBranch(repoOnMain);
      assert.strictEqual(shouldSkip1, true);

      const repoOnFeature = createMockRepository(testRepoPath, 'feature', getHeadCommit());
      const shouldSkip2 = await gate.shouldSkipBasedOnDefaultBranch(repoOnFeature);
      assert.strictEqual(shouldSkip2, false);
    });

    test('caches default branch after first fetch', async function () {
      this.timeout(20000);
      commitFile('README.md', '# Test', 'Initial commit');
      execSync('git branch -M main', { cwd: testRepoPath, stdio: 'pipe' });
      setupOriginHead('main');

      execSync('git checkout -b develop', { cwd: testRepoPath, stdio: 'pipe' });
      commitFile('develop.ts', 'export const d = 1;', 'develop commit');
      execSync('git checkout main', { cwd: testRepoPath, stdio: 'pipe' });

      const gate = new DefaultBranchGate(testRepoPath);

      const repo1 = createMockRepository(testRepoPath, 'main', getHeadCommit());
      await gate.shouldSkipBasedOnDefaultBranch(repo1);

      setupOriginHead('develop');
      clearMainBranchCandidatesCache(testRepoPath);

      const repo2 = createMockRepository(testRepoPath, 'main', getHeadCommit());
      const shouldSkip = await gate.shouldSkipBasedOnDefaultBranch(repo2);
      assert.strictEqual(shouldSkip, true, 'Should still use cached main, not the new develop');
    });
  });
});
