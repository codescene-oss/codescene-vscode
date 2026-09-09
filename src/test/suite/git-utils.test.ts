import * as assert from 'assert';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  clearMainBranchCandidatesCache,
  getDefaultBranch,
  getMainBranchCandidates,
  isMainBranch,
  isSafeRefName,
} from '../../git-utils';
import { CODE_SCENE_DIR, CONFIG_FILE_NAME } from '../../git/codescene-repo-config';

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

  suite('main branch detection', () => {
    test('getMainBranchCandidates uses origin/HEAD when set', async function () {
      this.timeout(20000);
      createBranchWithCommit('main');
      createBranch('master');
      commitFile('master.ts', 'export const master = true;', 'Commit on master');
      switchBranch('main');
      setupOriginHead('main');
      clearMainBranchCandidatesCache(testRepoPath);

      const candidates = await getMainBranchCandidates(testRepoPath);
      assert.deepStrictEqual(candidates, ['main']);
    });

    test('getMainBranchCandidates uses baseline_branch from config', async function () {
      this.timeout(20000);
      createBranchWithCommit('develop');
      createFeatureBranch('feature-on-develop');
      writeBaselineConfig('develop');

      const candidates = await getMainBranchCandidates(testRepoPath);
      assert.deepStrictEqual(candidates, ['develop']);
      assert.strictEqual(await isMainBranch('develop', testRepoPath), true);
      assert.strictEqual(await isMainBranch('main', testRepoPath), false);
    });

    test('config baseline_branch overrides origin/HEAD', async function () {
      this.timeout(20000);
      createBranchWithCommit('main');
      createBranch('develop');
      commitFile('develop.ts', 'export const d = true;', 'develop commit');
      switchBranch('main');
      setupOriginHead('main');
      writeBaselineConfig('develop');

      assert.strictEqual(await getDefaultBranch(testRepoPath), 'develop');
      const candidates = await getMainBranchCandidates(testRepoPath);
      assert.deepStrictEqual(candidates, ['develop']);
    });

    test('clearMainBranchCandidatesCache clears one repo', async function () {
      this.timeout(20000);
      createBranchWithCommit('main');
      await getMainBranchCandidates(testRepoPath);
      clearMainBranchCandidatesCache(testRepoPath);
      setupOriginHead('main');
      const candidates = await getMainBranchCandidates(testRepoPath);
      assert.deepStrictEqual(candidates, ['main']);
    });

    test('clearMainBranchCandidatesCache clears entire cache when no path given', async function () {
      this.timeout(20000);
      createBranchWithCommit('main');
      await getMainBranchCandidates(testRepoPath);
      clearMainBranchCandidatesCache();

      setupOriginHead('main');
      const candidates = await getMainBranchCandidates(testRepoPath);
      assert.deepStrictEqual(candidates, ['main']);
    });

    test('getDefaultBranch returns undefined when origin/HEAD is missing', async () => {
      createBranchWithCommit('main');
      assert.strictEqual(await getDefaultBranch(testRepoPath), undefined);
    });

    test('getDefaultBranch caches the result', async function () {
      this.timeout(20000);
      createBranchWithCommit('main');
      setupOriginHead('main');
      clearMainBranchCandidatesCache(testRepoPath);

      assert.strictEqual(await getDefaultBranch(testRepoPath), 'main');

      execSync('git symbolic-ref -d refs/remotes/origin/HEAD', { cwd: testRepoPath, stdio: 'pipe' });

      assert.strictEqual(await getDefaultBranch(testRepoPath), 'main');
    });

    test('clearMainBranchCandidatesCache also clears getDefaultBranch cache', async function () {
      this.timeout(20000);
      createBranchWithCommit('main');
      setupOriginHead('main');
      clearMainBranchCandidatesCache(testRepoPath);

      assert.strictEqual(await getDefaultBranch(testRepoPath), 'main');

      execSync('git symbolic-ref -d refs/remotes/origin/HEAD', { cwd: testRepoPath, stdio: 'pipe' });
      clearMainBranchCandidatesCache(testRepoPath);

      assert.strictEqual(await getDefaultBranch(testRepoPath), undefined);
    });
  });
  suite('isSafeRefName', () => {
    test('accepts valid branch names', () => {
      assert.strictEqual(isSafeRefName('main'), true);
      assert.strictEqual(isSafeRefName('master'), true);
      assert.strictEqual(isSafeRefName('feature/my-feature'), true);
      assert.strictEqual(isSafeRefName('bugfix-123'), true);
      assert.strictEqual(isSafeRefName('release_1.2.0'), true);
      assert.strictEqual(isSafeRefName('develop'), true);
      assert.strictEqual(isSafeRefName('user/feature/branch'), true);
    });

    test('rejects option-like names (leading dash)', () => {
      assert.strictEqual(isSafeRefName('--upload-pack=evil'), false);
      assert.strictEqual(isSafeRefName('-n'), false);
      assert.strictEqual(isSafeRefName('--exec=cmd'), false);
    });

    test('rejects empty or whitespace-only names', () => {
      assert.strictEqual(isSafeRefName(''), false);
      assert.strictEqual(isSafeRefName('   '), false);
    });

    test('rejects names with whitespace or control characters', () => {
      assert.strictEqual(isSafeRefName('branch name'), false);
      assert.strictEqual(isSafeRefName('branch\tname'), false);
      assert.strictEqual(isSafeRefName('branch\nname'), false);
    });

    test('rejects names with special shell characters', () => {
      assert.strictEqual(isSafeRefName('branch;echo'), false);
      assert.strictEqual(isSafeRefName('branch|pipe'), false);
      assert.strictEqual(isSafeRefName('branch$(cmd)'), false);
      assert.strictEqual(isSafeRefName('branch`cmd`'), false);
    });
  });
});
