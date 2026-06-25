import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import {
  GIT_CHANGE_LISTER_TEST_REPO,
  GitChangeListerFixture,
  setupGitChangeListerFixture,
  teardownGitChangeListerFixture,
} from './git-change-lister-fixtures';

suite('GitChangeLister changed files Test Suite', () => {
  let fixture: GitChangeListerFixture;

  setup(async () => {
    fixture = await setupGitChangeListerFixture();
  });

  teardown(() => {
    teardownGitChangeListerFixture();
  });

  test('getAllChangedFiles returns empty set for clean repository', async function () {
    this.timeout(20000);
    const changedFiles = await fixture.gitChangeLister.getAllChangedFiles(GIT_CHANGE_LISTER_TEST_REPO, GIT_CHANGE_LISTER_TEST_REPO);
    assert.strictEqual(changedFiles.size, 0);
  });

  test('getAllChangedFiles detects new untracked files', async function () {
    this.timeout(20000);
    const newFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'test.ts');
    fs.writeFileSync(newFile, 'console.log("test");');

    const changedFiles = await fixture.gitChangeLister.getAllChangedFiles(GIT_CHANGE_LISTER_TEST_REPO, GIT_CHANGE_LISTER_TEST_REPO);

    assert.ok(changedFiles.size > 0);
    assert.ok(Array.from(changedFiles).some((f) => f.endsWith('test.ts')));
  });

  test('getAllChangedFiles detects modified files', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const testFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'index.js');
    fs.writeFileSync(testFile, 'console.log("hello");');
    execSync('git add index.js', { cwd: GIT_CHANGE_LISTER_TEST_REPO });
    execSync('git commit -m "Add index.js"', { cwd: GIT_CHANGE_LISTER_TEST_REPO });

    fs.writeFileSync(testFile, 'console.log("modified");');

    const changedFiles = await fixture.gitChangeLister.getAllChangedFiles(GIT_CHANGE_LISTER_TEST_REPO, GIT_CHANGE_LISTER_TEST_REPO);

    assert.ok(changedFiles.size > 0);
    assert.ok(Array.from(changedFiles).some((f) => f.endsWith('index.js')));
  });

  test('getAllChangedFiles detects staged files', async function () {
    this.timeout(20000);
    const { execSync } = require('child_process');

    const newFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'script.py');
    fs.writeFileSync(newFile, 'print("hello")');
    execSync('git add script.py', { cwd: GIT_CHANGE_LISTER_TEST_REPO });

    const changedFiles = await fixture.gitChangeLister.getAllChangedFiles(GIT_CHANGE_LISTER_TEST_REPO, GIT_CHANGE_LISTER_TEST_REPO);

    assert.ok(changedFiles.size > 0);
    assert.ok(Array.from(changedFiles).some((f) => f.endsWith('script.py')));
  });

  test('getAllChangedFiles filters unsupported file types', async function () {
    this.timeout(20000);
    const txtFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'notes.txt');
    const mdFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'docs.md');
    const tsFile = path.join(GIT_CHANGE_LISTER_TEST_REPO, 'code.ts');
    fs.writeFileSync(txtFile, 'Some notes');
    fs.writeFileSync(mdFile, '# Documentation');
    fs.writeFileSync(tsFile, 'export const x = 1;');

    const changedFiles = await fixture.gitChangeLister.getAllChangedFiles(GIT_CHANGE_LISTER_TEST_REPO, GIT_CHANGE_LISTER_TEST_REPO);
    const fileNames = Array.from(changedFiles).map((f) => path.basename(f));

    assert.strictEqual(changedFiles.size, 1, 'Should only include supported file type');
    assert.ok(fileNames.includes('code.ts'), 'Should include .ts file');
  });
});
