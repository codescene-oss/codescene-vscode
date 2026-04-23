import * as assert from 'assert';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { getMergeBaseCommit, gitExecutor } from '../../git-utils';
import { isGitAvailable, resetGitAvailability } from '../../git/git-detection';
import { ExecResult } from '../../executor';
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

    test('returns closest merge-base when multiple main-like branches share the same base', async () => {
      const mainCommitSha = createBranchWithCommit('main');

      createBranch('master');
      commitFile('master.ts', 'export const master = true;', 'Commit on master');

      switchBranch('main');
      const featureCommitSha = createFeatureBranch('feature');

      const result = await testMergeBase('feature', featureCommitSha);

      assert.strictEqual(
        result,
        mainCommitSha,
        `Should return closest merge-base. Expected: ${mainCommitSha}, Got: ${result}`
      );
    });

    test('returns closest merge-base when feature is stacked on develop over main', async () => {
      const mainCommitSha = createBranchWithCommit('main');

      createBranch('develop');
      commitFile('develop.ts', 'export const onDevelop = true;', 'Commit on develop');
      const developCommitSha = getHeadCommit();

      createBranch('feature/test-suppression2');
      commitFile('feature.ts', 'export const feature = true;', 'Commit on feature');
      const featureCommitSha = getHeadCommit();

      const result = await testMergeBase('feature/test-suppression2', featureCommitSha);

      assert.strictEqual(
        result,
        developCommitSha,
        `Should return develop tip (closest merge-base), not main. Expected: ${developCommitSha}, Got: ${result} (main was: ${mainCommitSha})`
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

    test('returns first candidate when merge commit produces sibling merge-bases', async () => {
      const mainInitialSha = createBranchWithCommit('main');

      createBranch('develop');
      commitFile('develop.ts', 'export const onDevelop = true;', 'develop commit');
      const developSha = getHeadCommit();

      switchBranch('main');
      commitFile('main2.ts', 'export const onMain = true;', 'main second commit');
      const mainAdvancedSha = getHeadCommit();

      createBranch('feature-merge');
      commitFile('feature.ts', 'export const feature = true;', 'feature commit');

      execSync('git merge --no-ff develop -m "merge develop into feature"', { cwd: testRepoPath, stdio: 'pipe' });
      const featureMergeSha = getHeadCommit();

      const result = await testMergeBase('feature-merge', featureMergeSha);

      assert.strictEqual(
        result,
        mainAdvancedSha,
        `Should fall back to first candidate when no merge-base descends from all others. Expected: ${mainAdvancedSha}, Got: ${result} (develop was: ${developSha}, main initial was: ${mainInitialSha})`
      );
      assert.notStrictEqual(result, developSha, 'Must not be the develop-side merge-base');
    });

    suite('executor stub based error paths', () => {
      let restoreExecutor: (() => void) | undefined;

      function stubGitExecutor(responder: (args: string[]) => Promise<ExecResult> | ExecResult): () => void {
        const executor = gitExecutor as unknown as { execute: (...a: any[]) => any };
        const original = executor.execute.bind(gitExecutor);
        executor.execute = async (command: any) => responder(command.args);
        return () => {
          executor.execute = original;
        };
      }

      teardown(() => {
        if (restoreExecutor) {
          restoreExecutor();
          restoreExecutor = undefined;
        }
        resetGitAvailability();
      });

      test('mergeBaseWith handles ENOENT exit code', async () => {
        restoreExecutor = stubGitExecutor((args) => {
          if (args[0] === 'branch') {
            return { stdout: 'feature\nmain', stderr: '', exitCode: 0, duration: 0 };
          }
          if (args[0] === 'merge-base' && args[1] !== '--is-ancestor') {
            return { stdout: '', stderr: 'spawn ENOENT', exitCode: 'ENOENT', duration: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0, duration: 0 };
        });

        const repo = createMockRepository(testRepoPath, 'feature', 'deadbeef');
        const result = await getMergeBaseCommit(repo);

        assert.strictEqual(result, '', 'Should return empty when merge-base yields ENOENT');
        assert.strictEqual(isGitAvailable(), false, 'Should mark git as unavailable on ENOENT');
      });

      test('isAncestor handles ENOENT exit code and falls back to first candidate', async () => {
        const sha1 = 'a'.repeat(40);
        const sha2 = 'b'.repeat(40);

        restoreExecutor = stubGitExecutor((args) => {
          if (args[0] === 'branch') {
            return { stdout: 'feature\nmain\ndevelop', stderr: '', exitCode: 0, duration: 0 };
          }
          if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
            return { stdout: '', stderr: 'spawn ENOENT', exitCode: 'ENOENT', duration: 0 };
          }
          if (args[0] === 'merge-base' && args[2] === 'main') {
            return { stdout: sha1, stderr: '', exitCode: 0, duration: 0 };
          }
          if (args[0] === 'merge-base' && args[2] === 'develop') {
            return { stdout: sha2, stderr: '', exitCode: 0, duration: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0, duration: 0 };
        });

        const repo = createMockRepository(testRepoPath, 'feature', 'deadbeef');
        const result = await getMergeBaseCommit(repo);

        assert.strictEqual(result, sha1, 'Should fall back to first candidate when is-ancestor ENOENTs');
        assert.strictEqual(isGitAvailable(), false, 'Should mark git as unavailable on ENOENT');
      });

      test('isAncestor handles thrown ENOENT error and falls back to first candidate', async () => {
        const sha1 = 'a'.repeat(40);
        const sha2 = 'b'.repeat(40);

        restoreExecutor = stubGitExecutor((args) => {
          if (args[0] === 'branch') {
            return { stdout: 'feature\nmain\ndevelop', stderr: '', exitCode: 0, duration: 0 };
          }
          if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
            const err: any = new Error('spawn ENOENT');
            err.code = 'ENOENT';
            throw err;
          }
          if (args[0] === 'merge-base' && args[2] === 'main') {
            return { stdout: sha1, stderr: '', exitCode: 0, duration: 0 };
          }
          if (args[0] === 'merge-base' && args[2] === 'develop') {
            return { stdout: sha2, stderr: '', exitCode: 0, duration: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0, duration: 0 };
        });

        const repo = createMockRepository(testRepoPath, 'feature', 'deadbeef');
        const result = await getMergeBaseCommit(repo);

        assert.strictEqual(result, sha1, 'Should fall back to first candidate when is-ancestor throws');
        assert.strictEqual(isGitAvailable(), false, 'Should mark git as unavailable when caught error is ENOENT');
      });
    });
  });
});
