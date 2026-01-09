import * as assert from 'assert';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { getMergeBaseCommit } from '../../git-utils';
import { Repository, RepositoryState, Branch, RepositoryUIState } from '../../../types/git';

suite('Git Utils Test Suite', () => {
  const testRepoBasePath = path.join(__dirname, '../../../test-git-repo-git-utils');
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
      ? {
          type: 0,
          name: branchName,
          commit: commitSha,
        }
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

  function getHeadCommit(): string {
    return execSync('git rev-parse HEAD', { cwd: testRepoPath }).toString().trim();
  }

  function commitFile(filename: string, content: string, message: string): void {
    fs.writeFileSync(path.join(testRepoPath, filename), content);
    execSync('git add .', { cwd: testRepoPath });
    execSync(`git commit -m "${message}"`, { cwd: testRepoPath });
  }

  function createBranch(branchName: string): void {
    execSync(`git checkout -b ${branchName}`, { cwd: testRepoPath, stdio: 'pipe' });
  }

  function switchBranch(branchName: string): void {
    execSync(`git checkout ${branchName}`, { cwd: testRepoPath, stdio: 'pipe' });
  }

  function renameBranch(newName: string): void {
    execSync(`git branch -M ${newName}`, { cwd: testRepoPath, stdio: 'pipe' });
  }

  function createBranchWithCommit(branchName: string): string {
    createBranch(branchName);
    commitFile('README.md', '# Test', `Initial commit on ${branchName}`);
    return getHeadCommit();
  }

  function createFeatureBranch(branchName: string): string {
    createBranch(branchName);
    commitFile('feature.ts', 'export const feature = true;', 'Add feature');
    return getHeadCommit();
  }

  async function testMergeBase(branchName: string, commitSha: string): Promise<string> {
    const repo = createMockRepository(testRepoPath, branchName, commitSha);
    return await getMergeBaseCommit(repo);
  }

  suite('getMergeBaseCommit', () => {
    test('returns empty string when currentBranch is undefined', async () => {
      commitFile('README.md', '# Test', 'Initial commit');
      const repo = createMockRepository(testRepoPath, undefined, undefined);

      const result = await getMergeBaseCommit(repo);

      assert.strictEqual(result, '', 'Should return empty string when currentBranch is undefined');
    });

    test('returns empty string when repoPath is invalid', async () => {
      commitFile('README.md', '# Test', 'Initial commit');
      const commitSha = getHeadCommit();
      const nonExistentPath = '/non/existent/path/that/does/not/exist';
      const repo = createMockRepository(nonExistentPath, 'main', commitSha);

      const result = await getMergeBaseCommit(repo);

      assert.strictEqual(result, '', 'Should return empty string when repoPath does not exist');
    });

    test('returns HEAD commit when on main branch', async () => {
      commitFile('README.md', '# Test', 'Initial commit');
      const commitSha = getHeadCommit();
      createBranch('main');

      const result = await testMergeBase('main', commitSha);

      assert.strictEqual(
        result,
        commitSha,
        `Should return HEAD commit when on main branch. Expected: ${commitSha}, Got: ${result}`
      );
    });

    test('returns HEAD commit when on master branch', async () => {
      commitFile('README.md', '# Test', 'Initial commit');
      renameBranch('master');
      const commitSha = getHeadCommit();

      const result = await testMergeBase('master', commitSha);

      assert.strictEqual(
        result,
        commitSha,
        `Should return HEAD commit when on master branch. Expected: ${commitSha}, Got: ${result}`
      );
    });

    test('returns merge-base when on feature branch', async () => {
      const mainCommitSha = createBranchWithCommit('main');
      const featureCommitSha = createFeatureBranch('feature');

      const result = await testMergeBase('feature', featureCommitSha);

      assert.strictEqual(
        result,
        mainCommitSha,
        `Should return merge-base commit. Expected: ${mainCommitSha}, Got: ${result}`
      );
    });

    test('returns merge-base with develop branch as main candidate', async () => {
      const developCommitSha = createBranchWithCommit('develop');
      const featureCommitSha = createFeatureBranch('feature-develop');

      const result = await testMergeBase('feature-develop', featureCommitSha);

      assert.strictEqual(
        result,
        developCommitSha,
        `Should find merge-base with develop branch. Expected: ${developCommitSha}, Got: ${result}`
      );
    });

    test('returns empty string when no merge-base exists (orphan branches)', async () => {
      createBranchWithCommit('main');

      execSync('git checkout --orphan orphan-branch', { cwd: testRepoPath, stdio: 'pipe' });
      execSync('git rm -rf .', { cwd: testRepoPath, stdio: 'pipe' });
      commitFile('orphan.ts', 'export const orphan = true;', 'Orphan commit');
      const orphanCommitSha = getHeadCommit();

      const result = await testMergeBase('orphan-branch', orphanCommitSha);

      assert.strictEqual(
        result,
        '',
        'Should return empty string when no merge-base exists with any main branch candidate'
      );
    });

    test('returns first successful merge-base when multiple main branches exist', async () => {
      const mainCommitSha = createBranchWithCommit('main');

      createBranch('master');
      commitFile('master.ts', 'export const master = true;', 'Commit on master');

      switchBranch('main');
      const featureCommitSha = createFeatureBranch('feature');

      const result = await testMergeBase('feature', featureCommitSha);

      assert.strictEqual(
        result,
        mainCommitSha,
        `Should return first successful merge-base. Expected: ${mainCommitSha}, Got: ${result}`
      );
    });

    test('continues to next candidate when git merge-base fails', async () => {
      const developCommitSha = createBranchWithCommit('develop');
      const featureCommitSha = createFeatureBranch('feature-from-develop');

      const result = await testMergeBase('feature-from-develop', featureCommitSha);

      assert.strictEqual(
        result,
        developCommitSha,
        `Should continue to next candidate and find develop. Expected: ${developCommitSha}, Got: ${result}`
      );
    });

    test('returns empty string when all main branch candidates fail', async () => {
      createBranchWithCommit('custom-branch');
      const featureCommitSha = createFeatureBranch('feature-custom');

      const result = await testMergeBase('feature-custom', featureCommitSha);

      assert.strictEqual(
        result,
        '',
        'Should return empty string when no main branch candidates exist'
      );
    });
  });
});
