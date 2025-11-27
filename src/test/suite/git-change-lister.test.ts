import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { GitChangeLister } from '../../git/git-change-lister';
import { MockExecutor } from '../mocks/mock-executor';
import { MockGitAPI } from '../mocks/mock-git-api';
import { API } from '../../../types/git';

suite('GitChangeLister Test Suite', () => {
  const testRepoPath = path.join(__dirname, '../../../test-git-repo');
  let gitChangeLister: GitChangeLister;
  let mockGitApi: MockGitAPI;
  let mockExecutor: MockExecutor;

  setup(async () => {
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

    mockGitApi = new MockGitAPI();
    mockExecutor = new MockExecutor();
    gitChangeLister = new GitChangeLister(mockExecutor);
  });

  teardown(() => {
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  test('getAllChangedFiles returns empty set for clean repository', async function () {
    this.timeout(20000);
    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath);
    assert.strictEqual(changedFiles.size, 0);
  });

  test('getAllChangedFiles detects new untracked files', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const newFile = path.join(testRepoPath, 'test.ts');
    fs.writeFileSync(newFile, 'console.log("test");');

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath);

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

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath);

    assert.ok(changedFiles.size > 0);
    assert.ok(Array.from(changedFiles).some(f => f.endsWith('index.js')));
  });

  test('getAllChangedFiles detects staged files', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const newFile = path.join(testRepoPath, 'script.py');
    fs.writeFileSync(newFile, 'print("hello")');
    execSync('git add script.py', { cwd: testRepoPath });

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath);

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

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath);
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

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath);

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

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath);

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

    const changedFiles = await gitChangeLister.getAllChangedFiles(testRepoPath, testRepoPath);

    const fileNames = Array.from(changedFiles).map(f => path.basename(f));
    assert.ok(fileNames.includes('my file.ts'), 'Should include file with spaces: my file.ts');
    assert.ok(fileNames.includes('test file with spaces.js'), 'Should include file with spaces: test file with spaces.js');
  });
});
