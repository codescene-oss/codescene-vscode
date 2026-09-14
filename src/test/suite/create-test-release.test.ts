import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const scriptPath = path.join(__dirname, '../../../scripts/create-test-release.js');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createRepository(version: string): string {
  const repositoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codescene-test-release-'));
  git(repositoryPath, 'init', '-b', 'main');
  git(repositoryPath, 'config', 'user.email', 'test@example.com');
  git(repositoryPath, 'config', 'user.name', 'Test User');
  fs.writeFileSync(path.join(repositoryPath, 'package.json'), `${JSON.stringify({ version }, null, 2)}\n`);
  git(repositoryPath, 'add', 'package.json');
  git(repositoryPath, 'commit', '-m', 'Initial commit');
  return repositoryPath;
}

function runScript(repositoryPath: string, ...bumps: string[]) {
  const args = [scriptPath, ...bumps];
  return spawnSync(process.execPath, args, {
    cwd: repositoryPath,
    encoding: 'utf8',
  });
}

suite('Test Release Script Test Suite', () => {
  const repositories: string[] = [];

  teardown(() => {
    for (const repositoryPath of repositories.splice(0)) {
      fs.rmSync(repositoryPath, { recursive: true, force: true });
    }
  });

  test('increments semantic versions for every supported bump', () => {
    const { incrementVersion } = require('../../../scripts/create-test-release');
    const cases = [
      { bump: 'patch', expected: '1.2.4' },
      { bump: 'minor', expected: '1.3.0' },
      { bump: 'major', expected: '2.0.0' },
    ];

    for (const testCase of cases) {
      assert.strictEqual(incrementVersion('1.2.3', testCase.bump), testCase.expected);
    }
    assert.throws(() => incrementVersion('9007199254740991.0.0', 'major'), /safe integer/);
  });

  test('recognizes valid next release versions', () => {
    const { isNextVersion } = require('../../../scripts/create-test-release');
    const cases = [
      { candidate: '1.2.4', expected: true },
      { candidate: '1.3.0', expected: true },
      { candidate: '2.0.0', expected: true },
      { candidate: '1.2.3', expected: false },
      { candidate: '1.2.5', expected: false },
      { candidate: '1.3.1', expected: false },
      { candidate: '2.0.1', expected: false },
    ];

    for (const testCase of cases) {
      assert.strictEqual(isNextVersion('1.2.3', testCase.candidate), testCase.expected);
    }
    assert.strictEqual(isNextVersion('1.2.9007199254740991', '1.3.0'), true);
    assert.strictEqual(isNextVersion('9007199254740991.0.0', '1.0.0'), false);
  });

  test('creates the next patch test version by default', () => {
    const repositoryPath = createRepository('1.2.3');
    repositories.push(repositoryPath);
    const packageJsonBefore = fs.readFileSync(path.join(repositoryPath, 'package.json'), 'utf8');

    const result = runScript(repositoryPath);

    assert.strictEqual(result.status, 0, result.stderr);
    const shortSha = git(repositoryPath, 'rev-parse', '--short', 'HEAD');
    const expectedTag = `v1.2.4-test.${shortSha}`;
    assert.strictEqual(git(repositoryPath, 'tag', '--list'), expectedTag);
    assert.strictEqual(git(repositoryPath, 'cat-file', '-t', expectedTag), 'tag');
    assert.match(result.stdout, new RegExp(`git push origin ${expectedTag.replace(/\./g, '\\.')}`));
    assert.strictEqual(fs.readFileSync(path.join(repositoryPath, 'package.json'), 'utf8'), packageJsonBefore);
    assert.strictEqual(git(repositoryPath, 'status', '--short'), '');
  });

  test('creates a requested minor test version', () => {
    const repositoryPath = createRepository('1.2.3');
    repositories.push(repositoryPath);

    const result = runScript(repositoryPath, 'minor');

    assert.strictEqual(result.status, 0, result.stderr);
    const shortSha = git(repositoryPath, 'rev-parse', '--short', 'HEAD');
    assert.strictEqual(git(repositoryPath, 'tag', '--list'), `v1.3.0-test.${shortSha}`);
  });

  test('creates a SHA suffix of at least seven characters', () => {
    const repositoryPath = createRepository('1.2.3');
    repositories.push(repositoryPath);
    git(repositoryPath, 'config', 'core.abbrev', '4');

    const result = runScript(repositoryPath);

    assert.strictEqual(result.status, 0, result.stderr);
    const shortSha = git(repositoryPath, 'rev-parse', '--short=7', 'HEAD');
    assert.strictEqual(git(repositoryPath, 'tag', '--list'), `v1.2.4-test.${shortSha}`);
  });

  test('rejects an unsupported bump', () => {
    const repositoryPath = createRepository('1.2.3');
    repositories.push(repositoryPath);

    const result = runScript(repositoryPath, 'banana');

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Expected patch, minor, or major/);
    assert.strictEqual(git(repositoryPath, 'tag', '--list'), '');
  });

  test('rejects extra bump arguments', () => {
    const repositoryPath = createRepository('1.2.3');
    repositories.push(repositoryPath);

    const result = runScript(repositoryPath, 'patch', 'minor');

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Expected zero or one bump argument/);
    assert.strictEqual(git(repositoryPath, 'tag', '--list'), '');
  });

  test('rejects an empty bump argument', () => {
    const repositoryPath = createRepository('1.2.3');
    repositories.push(repositoryPath);

    const result = runScript(repositoryPath, '');

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Expected zero or one bump argument/);
    assert.strictEqual(git(repositoryPath, 'tag', '--list'), '');
  });

  test('rejects a malformed package version', () => {
    const versions = ['1.2', '01.2.3', '1.02.3', '1.2.03', '9007199254740992.1.1'];

    for (const version of versions) {
      const repositoryPath = createRepository(version);
      repositories.push(repositoryPath);

      const result = runScript(repositoryPath);

      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /Expected package version in x\.y\.z format/);
      assert.strictEqual(git(repositoryPath, 'tag', '--list'), '');
    }
  });

  test('rejects a dirty worktree', () => {
    const repositoryPath = createRepository('1.2.3');
    repositories.push(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'untracked.txt'), 'dirty');

    const result = runScript(repositoryPath);

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /clean git worktree/);
    assert.strictEqual(git(repositoryPath, 'tag', '--list'), '');
  });

  test('rejects a duplicate test tag', () => {
    const repositoryPath = createRepository('1.2.3');
    repositories.push(repositoryPath);
    const firstResult = runScript(repositoryPath);
    assert.strictEqual(firstResult.status, 0, firstResult.stderr);

    const result = runScript(repositoryPath);

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Tag already exists/);
  });
});
