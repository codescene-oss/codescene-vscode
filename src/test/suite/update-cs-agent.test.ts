import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const updateAgent = require('../../../scripts/update-cs-agent');

const fixturesDir = path.join(__dirname, '../../../src/test/fixtures');
const releaseZipBytes = fs.readFileSync(path.join(fixturesDir, 'cs-agent-release-linux-amd64.zip'));
const emptyZipBytes = fs.readFileSync(path.join(fixturesDir, 'cs-agent-release-empty.zip'));
const assetUrl = 'https://api.github.com/repos/empear-analytics/cs-agent/releases/assets/42';
const lookupUrl = 'https://api.github.com/repos/empear-analytics/cs-agent/releases/tags/v1.1.13';
const token = 'ghp_secret-token-value';

const release = { assets: [{ name: 'refactoring-agent-linux-amd64.zip', url: assetUrl }] };

suite('Update cs-agent Script Test Suite', () => {
  let tempDir: string;
  let pinFile: string;
  let targetDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-cs-agent-test-'));
    pinFile = path.join(tempDir, 'cs-agent.version');
    targetDir = path.join(tempDir, 'bin');
    fs.writeFileSync(pinFile, '1.1.13\n');
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('exports absolute paths for bin and cs-agent.version in the repo root', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    assert.strictEqual(updateAgent.targetDir, path.join(repoRoot, 'bin'));
    assert.strictEqual(updateAgent.pinPath, path.join(repoRoot, 'cs-agent.version'));
  });

  test('the committed cs-agent.version holds a valid version', () => {
    assert.doesNotThrow(() => updateAgent.resolveVersion({}, updateAgent.pinPath));
  });

  const resolveCases = [
    { name: 'reads the pin file', env: {}, file: '1.1.13\n', expected: '1.1.13' },
    { name: 'strips a v prefix and BOM', env: {}, file: '\uFEFFv1.2.3\r\n', expected: '1.2.3' },
    { name: 'prefers CS_AGENT_VERSION', env: { CS_AGENT_VERSION: 'v2.0.0' }, file: '1.1.13', expected: '2.0.0' },
    { name: 'ignores a blank CS_AGENT_VERSION', env: { CS_AGENT_VERSION: '  ' }, file: '1.1.13', expected: '1.1.13' },
    { name: 'rejects a malformed pin', env: {}, file: 'latest', error: /Invalid cs-agent version "latest"/ },
    { name: 'rejects a malformed override', env: { CS_AGENT_VERSION: '1.2' }, file: '1.1.13', error: /CS_AGENT_VERSION/ },
    { name: 'fails without a pin file', env: {}, file: undefined, error: /No cs-agent version/ },
  ];

  for (const testCase of resolveCases) {
    test(`resolveVersion ${testCase.name}`, () => {
      fs.rmSync(pinFile, { force: true });
      if (testCase.file !== undefined) {
        fs.writeFileSync(pinFile, testCase.file);
      }
      if (testCase.error) {
        assert.throws(() => updateAgent.resolveVersion(testCase.env, pinFile), testCase.error);
      } else {
        assert.strictEqual(updateAgent.resolveVersion(testCase.env, pinFile), testCase.expected);
      }
    });
  }

  const platformCases = [
    { platform: 'darwin', arch: 'arm64', asset: 'refactoring-agent-macos-aarch64.zip', archived: 'refactoring-agent-macos-aarch64', binary: 'cs-agent' },
    { platform: 'darwin', arch: 'x64', asset: 'refactoring-agent-macos-amd64.zip', archived: 'refactoring-agent-macos-amd64', binary: 'cs-agent' },
    { platform: 'linux', arch: 'arm64', asset: 'refactoring-agent-linux-aarch64.zip', archived: 'refactoring-agent-linux-aarch64', binary: 'cs-agent' },
    { platform: 'linux', arch: 'x64', asset: 'refactoring-agent-linux-amd64.zip', archived: 'refactoring-agent-linux-amd64', binary: 'cs-agent' },
    { platform: 'win32', arch: 'x64', asset: 'refactoring-agent-windows-amd64.zip', archived: 'refactoring-agent-windows-amd64.exe', binary: 'cs-agent.exe' },
  ];

  for (const c of platformCases) {
    test(`maps ${c.platform}-${c.arch} to the ${c.asset} release asset`, () => {
      assert.strictEqual(updateAgent.assetName(c.platform, c.arch), c.asset);
      assert.strictEqual(updateAgent.archivedBinaryName(c.platform, c.arch), c.archived);
      assert.strictEqual(updateAgent.binaryName(c.platform), c.binary);
    });
  }

  for (const [platform, arch] of [['win32', 'arm64'], ['freebsd', 'x64'], ['linux', 'ia32']]) {
    test(`rejects the unsupported target ${platform}-${arch}`, () => {
      assert.throws(() => updateAgent.assetName(platform, arch), /Unsupported platform\/arch for cs-agent/);
    });
  }

  const argCases = [
    { argv: [], expected: { platform: process.platform, arch: process.arch, force: false } },
    { argv: ['linux', 'arm64'], expected: { platform: 'linux', arch: 'arm64', force: false } },
    { argv: ['win32', 'x64', '--force'], expected: { platform: 'win32', arch: 'x64', force: true } },
    { argv: ['--force'], expected: { platform: process.platform, arch: process.arch, force: true } },
  ];

  for (const c of argCases) {
    test(`parseArgs reads [${c.argv.join(' ')}]`, () => {
      assert.deepStrictEqual(updateAgent.parseArgs(c.argv), c.expected);
    });
  }

  suite('pinned download', () => {
    let calls: { url: string; init: any }[];
    let logs: string[];

    const fakeFetch = (lookupStatus = 200, downloadStatus = 200, zipBytes = releaseZipBytes) => {
      return async (url: string, init: any) => {
        calls.push({ url, init });
        if (url.includes('/releases/tags/')) {
          return new Response(lookupStatus === 200 ? JSON.stringify(release) : 'nope', { status: lookupStatus });
        }
        return new Response(downloadStatus === 200 ? zipBytes : 'nope', { status: downloadStatus });
      };
    };

    const run = (options: { env?: Record<string, string>; fetchImpl?: any; force?: boolean } = {}) =>
      updateAgent.fetchPinned({
        env: options.env ?? { GITHUB_TOKEN: token },
        pinPath: pinFile,
        targetDir,
        platform: 'linux',
        arch: 'x64',
        force: options.force ?? false,
        fetchImpl: options.fetchImpl ?? fakeFetch(),
        log: (message: string) => logs.push(message),
      });

    const installed = () => path.join(targetDir, 'cs-agent');

    setup(() => {
      calls = [];
      logs = [];
    });

    test('downloads the pinned release asset and installs it as bin/cs-agent', async () => {
      await run();
      assert.deepStrictEqual(
        calls.map((call) => call.url),
        [lookupUrl, assetUrl],
      );
      assert.strictEqual(new Headers(calls[1].init.headers).get('Accept'), 'application/octet-stream');
      assert.strictEqual(new Headers(calls[0].init.headers).get('Authorization'), `token ${token}`);
      assert.strictEqual(fs.readFileSync(installed(), 'utf8'), '#!/bin/sh\necho cs-agent\n');
      assert.strictEqual(updateAgent.readStamp(targetDir), '1.1.13 linux-x64');
      if (process.platform !== 'win32') {
        assert.strictEqual(fs.statSync(installed()).mode & 0o111, 0o111);
      }
    });

    test('skips the download when the stamped binary is already present', async () => {
      await run();
      calls = [];
      await run();
      assert.deepStrictEqual(calls, []);
      assert.ok(logs.some((message) => message.includes('already present')));
    });

    test('downloads again when the stamp is for another target', async () => {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'cs-agent.exe'), 'windows agent');
      fs.writeFileSync(path.join(targetDir, updateAgent.stampFileName), '1.1.13 win32-x64\n');
      await run();
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(fs.existsSync(path.join(targetDir, 'cs-agent.exe')), false);
      assert.strictEqual(updateAgent.readStamp(targetDir), '1.1.13 linux-x64');
    });

    for (const localBinary of ['cs-agent', 'cs-agent.exe']) {
      test(`keeps a locally built ${localBinary} that has no stamp`, async () => {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, localBinary), 'local build');
        await run();
        assert.deepStrictEqual(calls, []);
        assert.strictEqual(fs.readFileSync(path.join(targetDir, localBinary), 'utf8'), 'local build');
        assert.ok(logs.some((message) => message.includes('locally built')));
      });
    }

    test('replaces a locally built binary when forced', async () => {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(installed(), 'local build');
      await run({ force: true });
      assert.strictEqual(fs.readFileSync(installed(), 'utf8'), '#!/bin/sh\necho cs-agent\n');
    });

    const failureCases = [
      { name: 'no token is set', options: { env: {} }, error: /GITHUB_TOKEN is required/ },
      { name: 'the release does not exist', options: { fetchImpl: fakeFetch(404) }, error: /Release v1\.1\.13 not found/ },
      { name: 'the token lacks access', options: { fetchImpl: fakeFetch(403) }, error: /lack access to empear-analytics\/cs-agent/ },
      { name: 'the download fails', options: { fetchImpl: fakeFetch(200, 500) }, error: /asset download failed .* HTTP 500/ },
      {
        name: 'the archive holds no agent binary',
        options: { fetchImpl: fakeFetch(200, 200, emptyZipBytes) },
        error: /has no refactoring-agent-linux-amd64/,
      },
    ];

    for (const testCase of failureCases) {
      test(`fails without installing anything when ${testCase.name}`, async () => {
        await assert.rejects(run(testCase.options), testCase.error);
        assert.strictEqual(fs.existsSync(installed()), false);
        assert.strictEqual(updateAgent.readStamp(targetDir), undefined);
      });
    }

    test('fails when the release has no asset for the target', async () => {
      const noAssets = async (url: string, init: any) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ assets: [] }), { status: 200 });
      };
      await assert.rejects(run({ fetchImpl: noAssets }), /has no asset named refactoring-agent-linux-amd64\.zip/);
    });

    test('never logs the token', async () => {
      await run();
      await run({ fetchImpl: fakeFetch(403), force: true }).catch(() => undefined);
      assert.ok(logs.every((message) => !message.includes(token)));
    });
  });
});
