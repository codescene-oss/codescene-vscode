import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const scriptPath = path.join(__dirname, '../../../scripts/release-flow.js');
const sha40 = '0123456789abcdef0123456789abcdef01234567';
const targets = ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64'];

function runScript(...args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
}

function runScriptWithInput(input: string, ...args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', input });
}

function vsixNames(prefix: string, version: string) {
  return targets.map((target) => `${prefix}-${version}-${target}.vsix`);
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-release-flow-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function manifests(version: string) {
  return {
    'package.json': `${JSON.stringify({ name: 'demo', version, lockfileVersion: 3 }, null, 2)}\n`,
    'package-lock.json': `${JSON.stringify(
      { name: 'demo', version, lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version } } },
      null,
      2
    )}\n`,
  };
}

function commitAs(repo: string, message: string) {
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', message);
}

function createRemote(dir: string, files: Record<string, string>) {
  const origin = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  git(dir, 'init', '--bare', '-b', 'main', origin);
  git(dir, 'clone', origin, seed);
  git(seed, 'checkout', '-B', 'main');
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(seed, name), content);
  }
  commitAs(seed, 'Initial commit');
  git(seed, 'push', 'origin', 'main');
  const work = path.join(dir, 'work');
  git(dir, 'clone', origin, work);
  return { origin, work };
}

function remoteLog(origin: string): string[] {
  return git(origin, 'log', 'main', '--format=%an <%ae> | %s').split('\n');
}

function realExec(command: string, args: string[], options: { cwd: string }): string {
  return require('../../../scripts/release-flow').runCommand(command, args, options);
}

suite('Release Flow Script Test Suite', function () {
  this.timeout(20000);

  test('classifies stable and test tags', () => {
    const { classifyTag } = require('../../../scripts/release-flow');
    const cases = [
      { tag: 'v1.2.3', expected: { kind: 'stable', version: '1.2.3' } },
      { tag: 'v0.30.0', expected: { kind: 'stable', version: '0.30.0' } },
      {
        tag: 'v1.2.3-test.abc1234',
        expected: { kind: 'test', version: '1.2.3-test.abc1234', baseVersion: '1.2.3', sha: 'abc1234' },
      },
      {
        tag: `v1.2.3-test.${sha40}`,
        expected: { kind: 'test', version: `1.2.3-test.${sha40}`, baseVersion: '1.2.3', sha: sha40 },
      },
    ];

    for (const testCase of cases) {
      assert.deepStrictEqual(classifyTag(testCase.tag), testCase.expected, testCase.tag);
    }
  });

  test('rejects malformed tags', () => {
    const { classifyTag } = require('../../../scripts/release-flow');
    const generic = (tag: string) => `Expected vX.Y.Z or vX.Y.Z-test.<commit-sha>, got ${tag}.`;
    const shaRule = (tag: string) => `Test tag commit sha must be 7 to 40 lowercase hex digits, got ${tag}.`;
    const cases = [
      { tag: 'v1.2.3-test.abc123', message: shaRule('v1.2.3-test.abc123') },
      { tag: `v1.2.3-test.${sha40}0`, message: shaRule(`v1.2.3-test.${sha40}0`) },
      { tag: 'v1.2.3-test.', message: shaRule('v1.2.3-test.') },
      { tag: 'v1.2.3-test.ABC1234', message: generic('v1.2.3-test.ABC1234') },
      { tag: 'v1.2.3-test.ghijklm', message: generic('v1.2.3-test.ghijklm') },
      { tag: 'v1.2.3-test.abc1234-extra', message: generic('v1.2.3-test.abc1234-extra') },
      { tag: 'v1', message: generic('v1') },
      { tag: 'v1.2.3-rc1', message: generic('v1.2.3-rc1') },
      { tag: 'v01.2.3', message: generic('v01.2.3') },
      { tag: 'v1.2.3.4', message: generic('v1.2.3.4') },
      { tag: '1.2.3', message: generic('1.2.3') },
      { tag: 'foo', message: generic('foo') },
      { tag: '', message: generic('') },
    ];

    for (const testCase of cases) {
      assert.throws(() => classifyTag(testCase.tag), { message: testCase.message }, JSON.stringify(testCase.tag));
    }
  });

  test('orders versions numerically', () => {
    const { compareVersions } = require('../../../scripts/release-flow');
    const cases = [
      { a: '0.9.12', b: '0.10.0', expected: -1 },
      { a: '0.10.0', b: '0.9.12', expected: 1 },
      { a: '1.2.3', b: '1.2.3', expected: 0 },
      { a: '1.2.3', b: '1.2.4', expected: -1 },
      { a: '1.3.0', b: '1.2.9', expected: 1 },
      { a: '2.0.0', b: '1.99.99', expected: 1 },
      { a: '1.0.0', b: '2.0.0', expected: -1 },
    ];

    for (const testCase of cases) {
      assert.strictEqual(compareVersions(testCase.a, testCase.b), testCase.expected, `${testCase.a} vs ${testCase.b}`);
    }
  });

  test('rejects non-x.y.z versions when comparing', () => {
    const { compareVersions } = require('../../../scripts/release-flow');
    const cases = [
      { a: '1.2', b: '1.2.3' },
      { a: '1.2.3', b: '1.2.3-test.abc1234' },
      { a: '01.2.3', b: '1.2.3' },
      { a: '1.2.3', b: 'v1.2.3' },
    ];

    for (const testCase of cases) {
      assert.throws(() => compareVersions(testCase.a, testCase.b), /x\.y\.z format/, `${testCase.a} vs ${testCase.b}`);
    }
  });

  test('classify CLI prints output lines', () => {
    const cases = [
      { tag: 'v1.2.3', stdout: 'kind=stable\nversion=1.2.3\nbase_version=\ntest_sha=\n' },
      {
        tag: 'v1.2.3-test.abc1234',
        stdout: 'kind=test\nversion=1.2.3-test.abc1234\nbase_version=1.2.3\ntest_sha=abc1234\n',
      },
    ];

    for (const testCase of cases) {
      const result = runScript('classify', testCase.tag);
      assert.strictEqual(result.status, 0, testCase.tag);
      assert.strictEqual(result.stdout.replace(/\r\n/g, '\n'), testCase.stdout, testCase.tag);
      assert.strictEqual(result.stderr, '', testCase.tag);
    }
  });

  test('classify CLI fails on malformed tag', () => {
    const cases = [
      { args: ['classify', 'foo'], stderr: /^Expected vX\.Y\.Z or vX\.Y\.Z-test\.<commit-sha>, got foo\.\r?\n$/ },
      { args: ['classify', 'v1.2.3-test.abc123'], stderr: /7 to 40 lowercase hex digits/ },
      { args: ['classify'], stderr: /Usage:/ },
      { args: ['classify', 'v1.2.3', 'v1.2.4'], stderr: /Usage:/ },
    ];

    for (const testCase of cases) {
      const result = runScript(...testCase.args);
      assert.strictEqual(result.status, 1, testCase.args.join(' '));
      assert.strictEqual(result.stdout, '', testCase.args.join(' '));
      assert.match(result.stderr, testCase.stderr, testCase.args.join(' '));
    }
  });

  test('is-next-version CLI', () => {
    const cases = [
      { current: '1.2.3', candidate: '1.2.4', ok: true },
      { current: '1.2.3', candidate: '1.3.0', ok: true },
      { current: '1.2.3', candidate: '2.0.0', ok: true },
      { current: '1.2.3', candidate: '1.2.3', ok: false },
      { current: '1.2.3', candidate: '1.2.5', ok: false },
      { current: '1.2.3', candidate: '1.4.0', ok: false },
      { current: '1.2.3', candidate: '3.0.0', ok: false },
    ];

    for (const testCase of cases) {
      const result = runScript('is-next-version', testCase.current, testCase.candidate);
      const label = `${testCase.current} -> ${testCase.candidate}`;
      assert.strictEqual(result.stdout, '', label);
      if (testCase.ok) {
        assert.strictEqual(result.status, 0, label);
        assert.strictEqual(result.stderr, '', label);
      } else {
        assert.strictEqual(result.status, 1, label);
        assert.strictEqual(
          result.stderr.trim(),
          `Test base ${testCase.candidate} is not the next patch, minor, or major after ${testCase.current}.`,
          label
        );
      }
    }
  });

  test('is-next-version CLI requires two arguments', () => {
    const result = runScript('is-next-version', '1.2.3');
    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /Usage:/);
  });

  test('rejects unknown command', () => {
    const cases = [['bogus'], []];

    for (const args of cases) {
      const result = runScript(...args);
      assert.strictEqual(result.status, 1, args.join(' '));
      assert.strictEqual(result.stdout, '', args.join(' '));
      assert.match(result.stderr, /Usage:/, args.join(' '));
    }
  });

  test('composes release notes', () => {
    const { composeReleaseNotes } = require('../../../scripts/release-flow');
    const base = {
      serverUrl: 'https://github.com',
      repository: 'codescene-oss/codescene-vscode',
      generated: "## What's Changed\n* Fix a bug",
    };
    const compareLink =
      'Full comparison since [v1.2.2](https://github.com/codescene-oss/codescene-vscode/compare/v1.2.2...v1.2.3-test.abc1234)';
    const cases = [
      { label: 'stable', input: { isTest: false, stableTag: '', tag: 'v1.2.3' }, expected: base.generated },
      {
        label: 'stable ignores a stable tag',
        input: { isTest: false, stableTag: 'v1.2.2', tag: 'v1.2.3' },
        expected: base.generated,
      },
      {
        label: 'test with stable tag',
        input: { isTest: true, stableTag: 'v1.2.2', tag: 'v1.2.3-test.abc1234' },
        expected: `${compareLink}\n\n${base.generated}`,
      },
      {
        label: 'test without stable tag',
        input: { isTest: true, stableTag: '', tag: 'v1.2.3-test.abc1234' },
        expected: base.generated,
      },
    ];

    for (const testCase of cases) {
      assert.strictEqual(composeReleaseNotes({ ...base, ...testCase.input }), testCase.expected, testCase.label);
    }
  });

  test('compose-notes CLI reads generated notes from stdin', () => {
    const generated = "## What's Changed\n* Fix a bug\n";
    const compareLink = 'Full comparison since [v1.2.2](https://github.com/o/r/compare/v1.2.2...v1.2.3-test.abc1234)';
    const cases = [
      {
        label: 'test with stable tag',
        args: ['true', 'v1.2.2', 'v1.2.3-test.abc1234'],
        stdout: `${compareLink}\n\n${generated}`,
      },
      { label: 'test without stable tag', args: ['true', '', 'v1.2.3-test.abc1234'], stdout: generated },
      { label: 'stable', args: ['false', '', 'v1.2.3'], stdout: generated },
    ];

    for (const testCase of cases) {
      const result = runScriptWithInput(generated, 'compose-notes', ...testCase.args, 'https://github.com', 'o/r');
      assert.strictEqual(result.status, 0, testCase.label);
      assert.strictEqual(result.stdout, testCase.stdout, testCase.label);
      assert.strictEqual(result.stderr, '', testCase.label);
    }
  });

  test('compose-notes CLI requires five arguments', () => {
    const result = runScriptWithInput('notes', 'compose-notes', 'true', 'v1.2.2', 'v1.2.3-test.abc1234');
    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /Usage:/);
  });

  test('lists the ten expected VSIX names', () => {
    const { expectedVsixNames } = require('../../../scripts/release-flow');

    assert.deepStrictEqual(expectedVsixNames('1.2.3'), [
      'codescene-vscode-1.2.3-darwin-x64.vsix',
      'codescene-vscode-1.2.3-darwin-arm64.vsix',
      'codescene-vscode-1.2.3-linux-x64.vsix',
      'codescene-vscode-1.2.3-linux-arm64.vsix',
      'codescene-vscode-1.2.3-win32-x64.vsix',
      'codescene-vscode-noace-1.2.3-darwin-x64.vsix',
      'codescene-vscode-noace-1.2.3-darwin-arm64.vsix',
      'codescene-vscode-noace-1.2.3-linux-x64.vsix',
      'codescene-vscode-noace-1.2.3-linux-arm64.vsix',
      'codescene-vscode-noace-1.2.3-win32-x64.vsix',
    ]);
    assert.strictEqual(
      expectedVsixNames('1.2.3-test.abc1234')[0],
      'codescene-vscode-1.2.3-test.abc1234-darwin-x64.vsix'
    );
  });

  test('resolves VSIX files by variant', () => {
    const { expectedVsixNames, resolveVsixFiles } = require('../../../scripts/release-flow');
    const version = '1.2.3';
    const inArtifactDir = (name: string) => `artifacts/${name.replace(`-${version}`, '').replace('.vsix', '')}/${name}`;
    const all: string[] = expectedVsixNames(version).map(inArtifactDir);
    const full = all.slice(0, 5);
    const noace = all.slice(5);
    const without = (name: string) => all.filter((file) => !file.endsWith(`/${name}`));
    const missingMessage = (...names: string[]) => ({ message: `Missing VSIX files: ${names.join(', ')}` });

    assert.deepStrictEqual(resolveVsixFiles(version, all), { full, noace }, 'complete set');
    assert.deepStrictEqual(resolveVsixFiles(version, [...all].reverse()), { full, noace }, 'order independent');
    assert.deepStrictEqual(
      resolveVsixFiles(version, [...all, 'artifacts/x/readme.txt', 'artifacts/x/other.vsix']),
      { full, noace },
      'extra unrelated files ignored'
    );

    const missingFull = 'codescene-vscode-1.2.3-linux-arm64.vsix';
    assert.throws(() => resolveVsixFiles(version, without(missingFull)), missingMessage(missingFull), 'missing full');

    const missingNoace = 'codescene-vscode-noace-1.2.3-win32-x64.vsix';
    assert.throws(
      () => resolveVsixFiles(version, without(missingNoace)),
      missingMessage(missingNoace),
      'missing noace'
    );

    const wrongVersion = expectedVsixNames('1.2.4').map(inArtifactDir);
    assert.throws(
      () => resolveVsixFiles(version, [...without('codescene-vscode-1.2.3-darwin-x64.vsix'), wrongVersion[0]]),
      missingMessage('codescene-vscode-1.2.3-darwin-x64.vsix'),
      'wrong-version file not matched'
    );

    assert.throws(() => resolveVsixFiles(version, full), missingMessage(...expectedVsixNames(version).slice(5)));
    assert.throws(() => resolveVsixFiles(version, []), missingMessage(...expectedVsixNames(version)));
  });

  test('resolves VSIX files with Windows separators', () => {
    const { expectedVsixNames, resolveVsixFiles } = require('../../../scripts/release-flow');
    const paths: string[] = expectedVsixNames('1.2.3').map((name: string) => `artifacts\\${name}`);

    const resolved = resolveVsixFiles('1.2.3', paths);

    assert.deepStrictEqual(resolved.full, paths.slice(0, 5));
    assert.deepStrictEqual(resolved.noace, paths.slice(5));
  });

  test('vsix-files CLI scans nested artifact directories', () => {
    const version = '1.2.3';

    withTempDir((dir) => {
      const pathsFor = (prefix: string) =>
        vsixNames(prefix, version).map((name, i) => path.join(dir, `${prefix}-${targets[i]}`, name));
      const fullPaths = pathsFor('codescene-vscode');
      const noacePaths = pathsFor('codescene-vscode-noace');
      for (const file of [...fullPaths, ...noacePaths]) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '');
      }
      fs.writeFileSync(path.join(dir, 'unrelated.txt'), '');

      const cases = [
        { variant: 'full', expected: fullPaths },
        { variant: 'noace', expected: noacePaths },
        { variant: 'all', expected: [...fullPaths, ...noacePaths] },
      ];
      for (const testCase of cases) {
        const result = runScript('vsix-files', version, testCase.variant, dir);
        assert.strictEqual(result.status, 0, testCase.variant);
        assert.strictEqual(result.stdout.replace(/\r\n/g, '\n'), `${testCase.expected.join('\n')}\n`, testCase.variant);
        assert.strictEqual(result.stderr, '', testCase.variant);
      }
    });
  });

  test('vsix-files CLI fails on missing files and bad arguments', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'codescene-vscode-1.2.3-linux-x64.vsix'), '');
      const cases = [
        {
          args: ['vsix-files', '1.2.3', 'all', dir],
          stderr: /Missing VSIX files: .*codescene-vscode-1\.2\.3-darwin-x64\.vsix/,
        },
        { args: ['vsix-files', '1.2.3', 'bogus', dir], stderr: /Variant must be full, noace or all, got bogus\./ },
        { args: ['vsix-files', '1.2.3', 'all'], stderr: /Usage:/ },
      ];

      for (const testCase of cases) {
        const result = runScript(...testCase.args);
        assert.strictEqual(result.status, 1, testCase.args.join(' '));
        assert.strictEqual(result.stdout, '', testCase.args.join(' '));
        assert.match(result.stderr, testCase.stderr, testCase.args.join(' '));
      }
    });
  });

  test('selects only unattached assets', () => {
    const { missingAssets } = require('../../../scripts/release-flow');
    const paths = ['artifacts/a/one.vsix', 'artifacts/b/two.vsix', 'artifacts/c/three.vsix'];
    const cases = [
      { label: 'none attached', existing: [], expected: paths },
      { label: 'unrelated attached', existing: ['notes.txt'], expected: paths },
      { label: 'some attached', existing: ['two.vsix'], expected: ['artifacts/a/one.vsix', 'artifacts/c/three.vsix'] },
      { label: 'all attached', existing: ['one.vsix', 'two.vsix', 'three.vsix'], expected: [] },
      { label: 'matches basename only', existing: ['artifacts/a/one.vsix'], expected: paths },
    ];

    for (const testCase of cases) {
      assert.deepStrictEqual(missingAssets(testCase.existing, paths), testCase.expected, testCase.label);
    }
  });

  test('missing-assets CLI prints missing paths and logs skipped ones', () => {
    withTempDir((dir) => {
      const paths = ['artifacts/a/one.vsix', 'artifacts/b/two.vsix', 'artifacts/c/three.vsix'];
      const cases = [
        { label: 'none attached', names: '', stdout: `${paths.join('\n')}\n`, stderr: '' },
        {
          label: 'some attached',
          names: 'two.vsix\nnotes.txt\n',
          stdout: 'artifacts/a/one.vsix\nartifacts/c/three.vsix\n',
          stderr: 'Asset already attached, skipping: two.vsix\n',
        },
        {
          label: 'all attached',
          names: 'one.vsix\r\ntwo.vsix\r\nthree.vsix\r\n',
          stdout: '',
          stderr:
            'Asset already attached, skipping: one.vsix\n' +
            'Asset already attached, skipping: two.vsix\n' +
            'Asset already attached, skipping: three.vsix\n',
        },
      ];

      for (const testCase of cases) {
        const namesFile = path.join(dir, 'existing.txt');
        fs.writeFileSync(namesFile, testCase.names);
        const result = runScript('missing-assets', namesFile, ...paths);
        assert.strictEqual(result.status, 0, testCase.label);
        assert.strictEqual(result.stdout.replace(/\r\n/g, '\n'), testCase.stdout, testCase.label);
        assert.strictEqual(result.stderr.replace(/\r\n/g, '\n'), testCase.stderr, testCase.label);
      }
    });
  });

  test('missing-assets CLI requires the names file', () => {
    const result = runScript('missing-assets');
    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /Usage:/);
  });

  test('evaluates the test gate', () => {
    const { evaluateTestGate } = require('../../../scripts/release-flow');
    const run = (status: string, conclusion: string | null, event: string, id: number) => ({
      status,
      conclusion,
      event,
      html_url: `https://github.com/org/repo/actions/runs/${id}`,
    });
    const cases = [
      {
        label: 'success via push',
        runs: [run('completed', 'success', 'push', 1)],
        pass: true,
        reason: 'success',
        fragment: 'actions/runs/1',
      },
      {
        label: 'success via pull_request alongside a failed run',
        runs: [run('completed', 'failure', 'push', 2), run('completed', 'success', 'pull_request', 3)],
        pass: true,
        reason: 'success',
        fragment: 'actions/runs/3',
      },
      {
        label: 'in progress only',
        runs: [run('in_progress', null, 'push', 4)],
        pass: false,
        reason: 'in-progress',
        fragment: 'Re-run this workflow by tag',
      },
      {
        label: 'queued only',
        runs: [run('queued', null, 'push', 5)],
        pass: false,
        reason: 'in-progress',
        fragment: 'still running',
      },
      {
        label: 'in progress plus failed',
        runs: [run('completed', 'failure', 'push', 6), run('in_progress', null, 'pull_request', 7)],
        pass: false,
        reason: 'in-progress',
        fragment: 'Re-run this workflow by tag',
      },
      {
        label: 'failed only',
        runs: [run('completed', 'failure', 'push', 8), run('completed', 'timed_out', 'pull_request', 9)],
        pass: false,
        reason: 'failed',
        fragment: 'failure, timed_out',
      },
      {
        label: 'cancelled only',
        runs: [run('completed', 'cancelled', 'push', 10)],
        pass: false,
        reason: 'failed',
        fragment: 'cancelled',
      },
      {
        label: 'empty list',
        runs: [],
        pass: false,
        reason: 'absent',
        fragment: 'tested PR merge commit',
      },
    ];

    for (const testCase of cases) {
      const result = evaluateTestGate(testCase.runs);
      assert.strictEqual(result.pass, testCase.pass, testCase.label);
      assert.strictEqual(result.reason, testCase.reason, testCase.label);
      assert.ok(result.message.includes(testCase.fragment), `${testCase.label}: ${result.message}`);
    }
  });

  test('test gate messages name the commit', () => {
    const { evaluateTestGate } = require('../../../scripts/release-flow');
    assert.ok(evaluateTestGate([], sha40).message.includes(sha40));
    assert.ok(evaluateTestGate([], sha40).message.includes('"Run tests"'));
  });

  test('test-gate CLI exit codes', () => {
    const passing = JSON.stringify([
      { status: 'completed', conclusion: 'success', event: 'push', html_url: 'https://example.test/runs/1' },
    ]);
    const failing = JSON.stringify([
      { status: 'completed', conclusion: 'failure', event: 'push', html_url: 'https://example.test/runs/2' },
    ]);
    const cases = [
      { label: 'pass', input: passing, status: 0, stdout: /runs\/1/, stderr: /^$/ },
      { label: 'absent', input: '[]', status: 1, stdout: /^$/, stderr: /No "Run tests" run exists for/ },
      { label: 'failed', input: failing, status: 1, stdout: /^$/, stderr: /conclusions: failure/ },
    ];

    for (const testCase of cases) {
      const result = runScriptWithInput(testCase.input, 'test-gate', sha40);
      assert.strictEqual(result.status, testCase.status, testCase.label);
      assert.match(result.stdout, testCase.stdout, testCase.label);
      assert.match(result.stderr, testCase.stderr, testCase.label);
    }
  });

  test('test-gate CLI rejects bad input', () => {
    const cases = [
      { label: 'not json', args: ['test-gate', sha40], input: 'nope', stderr: /JSON/i },
      { label: 'not an array', args: ['test-gate', sha40], input: '{}', stderr: /JSON array/ },
      { label: 'missing sha', args: ['test-gate'], input: '[]', stderr: /Usage:/ },
    ];

    for (const testCase of cases) {
      const result = runScriptWithInput(testCase.input, ...testCase.args);
      assert.strictEqual(result.status, 1, testCase.label);
      assert.strictEqual(result.stdout, '', testCase.label);
      assert.match(result.stderr, testCase.stderr, testCase.label);
    }
  });

  test('publishes to the Marketplace tolerating existing versions', () => {
    const { publishToMarketplace } = require('../../../scripts/release-flow');
    const files = vsixNames('codescene-vscode', '1.2.3');
    const cases = [
      {
        label: 'all succeed',
        results: ['ok', 'ok', 'ok', 'ok', 'ok'],
        calls: files,
        published: files,
        skipped: [],
        logs: [],
      },
      {
        label: 'second file already exists',
        results: ['ok', 'exists', 'ok', 'ok', 'ok'],
        calls: files,
        published: [files[0], files[2], files[3], files[4]],
        skipped: [files[1]],
        logs: [`Already published, skipping: ${files[1]}`],
      },
      {
        label: 'every file already exists',
        results: ['exists', 'exists', 'exists', 'exists', 'exists'],
        calls: files,
        published: [],
        skipped: files,
        logs: files.map((file) => `Already published, skipping: ${file}`),
      },
      {
        label: 'third file fails with another error',
        results: ['ok', 'exists', 'fail', 'ok', 'ok'],
        calls: files.slice(0, 3),
        error: /Failed to publish .*linux-x64\.vsix[\s\S]*401 Unauthorized/,
        logs: [`Already published, skipping: ${files[1]}`, 'Error: 401 Unauthorized'],
      },
    ];
    const outputs: Record<string, { status: number; output: string }> = {
      ok: { status: 0, output: 'Published' },
      exists: { status: 1, output: 'ERROR: codescene-vscode v1.2.3 already exists.' },
      fail: { status: 1, output: 'Error: 401 Unauthorized' },
    };

    for (const testCase of cases) {
      const calls: string[] = [];
      const logs: string[] = [];
      const runPublish = (file: string) => {
        calls.push(file);
        return outputs[testCase.results[calls.length - 1]];
      };
      const publish = () => publishToMarketplace(files, runPublish, (line: string) => logs.push(line));
      if (testCase.error) {
        assert.throws(publish, testCase.error, testCase.label);
      } else {
        const result = publish();
        assert.deepStrictEqual(result.published, testCase.published, testCase.label);
        assert.deepStrictEqual(result.skipped, testCase.skipped, testCase.label);
      }
      assert.deepStrictEqual(calls, testCase.calls, testCase.label);
      assert.deepStrictEqual(logs, testCase.logs, testCase.label);
    }
  });

  test('publish-marketplace CLI requires files', () => {
    const result = runScript('publish-marketplace');
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  });

  test('publish-marketplace CLI runs vsce per file and tolerates existing versions', () => {
    withTempDir((dir) => {
      const fakeVsce = path.join(dir, 'fake-vsce.js');
      fs.writeFileSync(
        fakeVsce,
        [
          'const file = process.argv[process.argv.length - 1];',
          "console.log('vsce ' + process.argv.slice(2).join(' '));",
          "if (file.includes('exists')) { console.error('already exists'); process.exit(1); }",
          "if (file.includes('boom')) { console.error('boom'); process.exit(1); }",
        ].join('\n')
      );
      if (process.platform === 'win32') {
        fs.writeFileSync(path.join(dir, 'vsce.cmd'), `@"${process.execPath}" "${fakeVsce}" %*\r\n`);
      } else {
        const launcher = path.join(dir, 'vsce');
        fs.writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${fakeVsce}" "$@"\n`);
        fs.chmodSync(launcher, 0o755);
      }
      const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` };
      const run = (...files: string[]) =>
        spawnSync(process.execPath, [scriptPath, 'publish-marketplace', ...files], { encoding: 'utf8', env });

      const tolerated = run('a.vsix', 'exists.vsix', 'c.vsix');
      assert.strictEqual(tolerated.status, 0, tolerated.stderr);
      assert.match(tolerated.stdout, /vsce publish --azure-credential --packagePath a\.vsix/);
      assert.match(tolerated.stdout, /--packagePath c\.vsix/);
      assert.match(tolerated.stdout, /Published 2 file\(s\), skipped 1 already published\./);
      assert.match(tolerated.stderr, /Already published, skipping: exists\.vsix/);

      const failed = run('a.vsix', 'boom.vsix', 'c.vsix');
      assert.strictEqual(failed.status, 1);
      assert.match(failed.stderr, /Failed to publish boom\.vsix/);
      assert.doesNotMatch(failed.stdout, /--packagePath c\.vsix/);
    });
  });

  test('records a higher version as one bot commit', function () {
    this.timeout(60000);
    const { recordVersion } = require('../../../scripts/release-flow');

    withTempDir((dir) => {
      const { origin, work } = createRemote(dir, manifests('1.2.3'));
      const before = remoteLog(origin);

      const result = recordVersion({ cwd: work, version: '1.3.0', exec: realExec, log: () => {} });

      assert.deepStrictEqual(result, { changed: true, attempt: 1 });
      const after = remoteLog(origin);
      assert.strictEqual(after.length, before.length + 1);
      assert.deepStrictEqual(after.slice(1), before);
      assert.strictEqual(
        after[0],
        'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> | chore(release): set version to 1.3.0'
      );
      assert.deepStrictEqual(git(origin, 'show', '--name-only', '--format=', 'main').split('\n').sort(), [
        'package-lock.json',
        'package.json',
      ]);
      assert.strictEqual(git(origin, 'show', 'main:package.json').includes('"version": "1.3.0"'), true);
      assert.strictEqual(git(origin, 'show', 'main:package-lock.json').includes('"version": "1.2.3"'), false);
    });
  });

  test('leaves main untouched when it is at or above the version', function () {
    this.timeout(60000);
    const { recordVersion } = require('../../../scripts/release-flow');
    const cases = [
      { label: 'equal', onMain: '1.3.0' },
      { label: 'higher patch', onMain: '1.3.1' },
      { label: 'higher minor', onMain: '1.4.0' },
      { label: 'higher major', onMain: '2.0.0' },
    ];

    for (const testCase of cases) {
      withTempDir((dir) => {
        const { origin, work } = createRemote(dir, manifests(testCase.onMain));
        const head = git(origin, 'rev-parse', 'main');
        const logs: string[] = [];

        const result = recordVersion({
          cwd: work,
          version: '1.3.0',
          exec: realExec,
          log: (line: string) => logs.push(line),
        });

        assert.deepStrictEqual(result, { changed: false }, testCase.label);
        assert.strictEqual(git(origin, 'rev-parse', 'main'), head, testCase.label);
        assert.deepStrictEqual(
          logs,
          [`main already at ${testCase.onMain}; nothing to record for 1.3.0.`],
          testCase.label
        );
      });
    }
  });

  test('retries on the new tip when main moves', function () {
    this.timeout(60000);
    const { recordVersion } = require('../../../scripts/release-flow');

    withTempDir((dir) => {
      const { origin, work } = createRemote(dir, { ...manifests('1.2.3'), 'README.md': 'readme\n' });
      const other = path.join(dir, 'other');
      git(dir, 'clone', origin, other);
      const logs: string[] = [];
      let pushes = 0;
      const exec = (command: string, args: string[], options: { cwd: string }) => {
        if (command === 'git' && args[0] === 'push') {
          pushes++;
          if (pushes === 1) {
            fs.writeFileSync(path.join(other, 'README.md'), 'competing change\n');
            commitAs(other, 'docs: competing change');
            git(other, 'push', 'origin', 'main');
          }
        }
        return realExec(command, args, options);
      };

      const result = recordVersion({ cwd: work, version: '1.3.0', exec, log: (line: string) => logs.push(line) });

      assert.deepStrictEqual(result, { changed: true, attempt: 2 });
      assert.strictEqual(pushes, 2);
      assert.deepStrictEqual(logs, ['Push rejected, retrying on the new main tip (attempt 1/5).']);
      const history = remoteLog(origin);
      assert.strictEqual(history.length, 3);
      assert.match(history[0], /chore\(release\): set version to 1\.3\.0$/);
      assert.match(history[1], /docs: competing change$/);
      assert.match(history[2], /Initial commit$/);
      assert.strictEqual(git(origin, 'show', 'main:README.md'), 'competing change');
      assert.strictEqual(git(origin, 'show', '--name-only', '--format=', 'main~1'), 'README.md');
    });
  });

  test('fails after the attempt limit', function () {
    this.timeout(60000);
    const { recordVersion } = require('../../../scripts/release-flow');

    withTempDir((dir) => {
      const { origin, work } = createRemote(dir, manifests('1.2.3'));
      const head = git(origin, 'rev-parse', 'main');
      const logs: string[] = [];
      let pushes = 0;
      const exec = (command: string, args: string[], options: { cwd: string }) => {
        if (command === 'git' && args[0] === 'push') {
          pushes++;
          throw new Error('remote rejected');
        }
        return realExec(command, args, options);
      };

      assert.throws(
        () => recordVersion({ cwd: work, version: '1.3.0', attempts: 3, exec, log: (line: string) => logs.push(line) }),
        { message: 'Could not record version 1.3.0 on main after 3 attempts.' }
      );

      assert.strictEqual(pushes, 3);
      assert.deepStrictEqual(logs, [
        'Push rejected, retrying on the new main tip (attempt 1/3).',
        'Push rejected, retrying on the new main tip (attempt 2/3).',
        'Push rejected, retrying on the new main tip (attempt 3/3).',
      ]);
      assert.strictEqual(git(origin, 'rev-parse', 'main'), head);
    });
  });

  test('refuses to commit when files other than the version files changed', function () {
    this.timeout(60000);
    const { recordVersion } = require('../../../scripts/release-flow');

    withTempDir((dir) => {
      const { origin, work } = createRemote(dir, { ...manifests('1.2.3'), 'README.md': 'readme\n' });
      const head = git(origin, 'rev-parse', 'main');
      const exec = (command: string, args: string[], options: { cwd: string }) => {
        const output = realExec(command, args, options);
        if (command === 'npm') {
          fs.writeFileSync(path.join(work, 'README.md'), 'changed by a lifecycle script\n');
        }
        return output;
      };

      assert.throws(() => recordVersion({ cwd: work, version: '1.3.0', exec, log: () => {} }), {
        message: 'Expected only package-lock.json and package.json to change, got: README.md, package-lock.json, package.json.',
      });

      assert.strictEqual(git(origin, 'rev-parse', 'main'), head);
    });
  });

  test('changes only the version fields in the real manifests', function () {
    this.timeout(120000);
    const { recordVersion } = require('../../../scripts/release-flow');
    const repoRoot = path.join(__dirname, '../../..');
    const files: Record<string, string> = {};
    for (const name of ['package.json', 'package-lock.json']) {
      files[name] = fs.readFileSync(path.join(repoRoot, name), 'utf8');
    }
    const [major] = JSON.parse(files['package.json']).version.split('.').map(Number);

    withTempDir((dir) => {
      const { work } = createRemote(dir, files);

      const result = recordVersion({ cwd: work, version: `${major + 1}.0.0`, exec: realExec, log: () => {} });

      assert.deepStrictEqual(result, { changed: true, attempt: 1 });
      assert.strictEqual(
        git(work, 'diff', '--numstat', 'HEAD~1', 'HEAD').replace(/\r\n/g, '\n'),
        '2\t2\tpackage-lock.json\n1\t1\tpackage.json'
      );
    });
  });

  test('record-version CLI records the version in the working directory', function () {
    this.timeout(60000);

    withTempDir((dir) => {
      const { origin, work } = createRemote(dir, manifests('1.2.3'));

      const recorded = spawnSync(process.execPath, [scriptPath, 'record-version', '1.3.0'], {
        cwd: work,
        encoding: 'utf8',
      });
      assert.strictEqual(recorded.status, 0, recorded.stderr);
      assert.match(remoteLog(origin)[0], /chore\(release\): set version to 1\.3\.0$/);

      const head = git(origin, 'rev-parse', 'main');
      const repeated = spawnSync(process.execPath, [scriptPath, 'record-version', '1.3.0'], {
        cwd: work,
        encoding: 'utf8',
      });
      assert.strictEqual(repeated.status, 0, repeated.stderr);
      assert.match(repeated.stdout, /main already at 1\.3\.0; nothing to record for 1\.3\.0\./);
      assert.strictEqual(git(origin, 'rev-parse', 'main'), head);
    });
  });

  test('record-version CLI requires exactly one version', () => {
    const cases = [['record-version'], ['record-version', '1.3.0', '1.4.0']];

    for (const args of cases) {
      const result = runScript(...args);
      assert.strictEqual(result.status, 1, args.join(' '));
      assert.strictEqual(result.stdout, '', args.join(' '));
      assert.match(result.stderr, /Usage:/, args.join(' '));
    }
  });

  test('decides promotion', () => {
    const { promotionAction } = require('../../../scripts/release-flow');
    const cases = [
      { tag: 'v1.2.3', latest: '', expected: 'promote' },
      { tag: 'v1.2.3', latest: undefined, expected: 'promote' },
      { tag: 'v1.2.4', latest: 'v1.2.3', expected: 'promote' },
      { tag: 'v1.3.0', latest: 'v1.2.9', expected: 'promote' },
      { tag: 'v2.0.0', latest: 'v1.99.99', expected: 'promote' },
      { tag: 'v0.10.0', latest: 'v0.9.12', expected: 'promote' },
      { tag: 'v1.2.3', latest: 'v1.2.3', expected: 'unchanged' },
      { tag: 'v1.2.3', latest: 'v1.2.4', expected: 'superseded' },
      { tag: 'v1.2.9', latest: 'v1.3.0', expected: 'superseded' },
      { tag: 'v1.99.99', latest: 'v2.0.0', expected: 'superseded' },
      { tag: 'v0.9.12', latest: 'v0.10.0', expected: 'superseded' },
    ];

    for (const testCase of cases) {
      assert.strictEqual(
        promotionAction(testCase.tag, testCase.latest),
        testCase.expected,
        `${testCase.tag} vs ${JSON.stringify(testCase.latest)}`
      );
    }

    const rejected = [
      { tag: 'v1.2.3-test.abc1234', latest: '' },
      { tag: 'v1.2.3-test.abc1234', latest: 'v1.2.2' },
      { tag: 'v1.2.3', latest: 'v1.2.2-test.abc1234' },
      { tag: 'foo', latest: 'v1.2.2' },
      { tag: 'v1.2.3', latest: 'foo' },
    ];

    for (const testCase of rejected) {
      assert.throws(() => promotionAction(testCase.tag, testCase.latest), Error, `${testCase.tag} vs ${testCase.latest}`);
    }
  });

  test('promotion CLI prints the action', () => {
    const cases = [
      { args: ['promotion', 'v1.2.3'], stdout: 'promote\n' },
      { args: ['promotion', 'v1.2.3', ''], stdout: 'promote\n' },
      { args: ['promotion', 'v1.2.4', 'v1.2.3'], stdout: 'promote\n' },
      { args: ['promotion', 'v1.2.3', 'v1.2.3'], stdout: 'unchanged\n' },
      { args: ['promotion', 'v1.2.3', 'v1.2.4'], stdout: 'superseded\n' },
    ];

    for (const testCase of cases) {
      const result = runScript(...testCase.args);
      assert.strictEqual(result.status, 0, testCase.args.join(' '));
      assert.strictEqual(result.stdout.replace(/\r\n/g, '\n'), testCase.stdout, testCase.args.join(' '));
      assert.strictEqual(result.stderr, '', testCase.args.join(' '));
    }
  });

  test('promotion CLI rejects test tags and bad arguments', () => {
    const cases = [
      { args: ['promotion', 'v1.2.3-test.abc1234'], stderr: /stable vX\.Y\.Z tag/ },
      { args: ['promotion', 'v1.2.3', 'v1.2.2-test.abc1234'], stderr: /stable vX\.Y\.Z tag/ },
      { args: ['promotion', 'foo'], stderr: /Expected vX\.Y\.Z/ },
      { args: ['promotion'], stderr: /Usage:/ },
      { args: ['promotion', 'v1.2.3', 'v1.2.2', 'v1.2.1'], stderr: /Usage:/ },
    ];

    for (const testCase of cases) {
      const result = runScript(...testCase.args);
      assert.strictEqual(result.status, 1, testCase.args.join(' '));
      assert.strictEqual(result.stdout, '', testCase.args.join(' '));
      assert.match(result.stderr, testCase.stderr, testCase.args.join(' '));
    }
  });
});
