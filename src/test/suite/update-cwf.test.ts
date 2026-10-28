import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const updateCwf = require('../../../scripts/update-cwf');

type ResolveCase = {
  name: string;
  env: { CWF_VERSION?: string };
  fileContent?: string;
  expected?: string;
  error?: RegExp[];
};

function writePinFile(pinFile: string, fileContent?: string) {
  fs.rmSync(pinFile, { force: true });
  if (fileContent !== undefined) {
    fs.writeFileSync(pinFile, fileContent, 'utf8');
  }
}

function assertResolveError(testCase: ResolveCase, pinFile: string) {
  assert.throws(
    () => updateCwf.resolveVersion(testCase.env, pinFile),
    (err: Error) => {
      assert.ok(err instanceof Error, testCase.name);
      for (const pattern of testCase.error!) {
        assert.match(err.message, pattern, testCase.name);
      }
      return true;
    },
    testCase.name,
  );
}

suite('Update CWF Script Test Suite', () => {
  let tempDir: string;
  let pinFile: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-cwf-'));
    pinFile = path.join(tempDir, 'cwf.version');
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('exports version resolution without running the script when required', () => {
    assert.strictEqual(typeof updateCwf.parseVersion, 'function');
    assert.strictEqual(typeof updateCwf.resolveVersion, 'function');
  });

  test('exports absolute paths for the repo root, cs-cwf and cwf.version', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    assert.strictEqual(path.resolve(updateCwf.projectRoot), repoRoot);
    assert.strictEqual(updateCwf.targetDir, path.join(repoRoot, 'cs-cwf'));
    assert.strictEqual(updateCwf.pinPath, path.join(repoRoot, 'cwf.version'));
    assert.ok(path.isAbsolute(updateCwf.targetDir));
    assert.ok(path.isAbsolute(updateCwf.pinPath));
  });

  test('the committed cwf.version is a valid pin with a trailing newline', () => {
    assert.strictEqual(fs.readFileSync(updateCwf.pinPath, 'utf8'), '2.5.8\n');
    assert.strictEqual(updateCwf.resolveVersion({}, updateCwf.pinPath), '2.5.8');
  });

  test('resolveVersion applies the override and file rules', () => {
    const cases: ResolveCase[] = [
      { name: 'plain file', env: {}, fileContent: '2.5.8', expected: '2.5.8' },
      { name: 'file with newline', env: {}, fileContent: '2.5.8\n', expected: '2.5.8' },
      { name: 'file with v prefix', env: {}, fileContent: 'v2.5.8', expected: '2.5.8' },
      { name: 'file with BOM and CRLF', env: {}, fileContent: '\uFEFF2.5.8\r\n', expected: '2.5.8' },
      { name: 'multi-digit parts', env: {}, fileContent: '10.20.300', expected: '10.20.300' },
      { name: 'override beats file', env: { CWF_VERSION: '2.6.0' }, fileContent: '2.5.8', expected: '2.6.0' },
      { name: 'override with v prefix', env: { CWF_VERSION: 'v2.6.0' }, fileContent: '2.5.8', expected: '2.6.0' },
      {
        name: 'override with BOM and spaces',
        env: { CWF_VERSION: '\uFEFF 2.6.0 ' },
        fileContent: '2.5.8',
        expected: '2.6.0',
      },
      { name: 'override without file', env: { CWF_VERSION: '2.6.0' }, expected: '2.6.0' },
      { name: 'empty override uses file', env: { CWF_VERSION: '' }, fileContent: '2.5.8', expected: '2.5.8' },
      { name: 'blank override uses file', env: { CWF_VERSION: '  ' }, fileContent: '2.5.8', expected: '2.5.8' },
      { name: 'file missing patch', env: {}, fileContent: '2.5', error: [/"2\.5"/, /cwf\.version/] },
      {
        name: 'file with prerelease suffix',
        env: {},
        fileContent: '2.5.8-beta',
        error: [/2\.5\.8-beta/, /cwf\.version/],
      },
      { name: 'file with uppercase V', env: {}, fileContent: 'V2.5.8', error: [/V2\.5\.8/, /cwf\.version/] },
      { name: 'file with latest', env: {}, fileContent: 'latest', error: [/latest/, /cwf\.version/] },
      { name: 'empty file', env: {}, fileContent: '', error: [/cwf\.version/] },
      { name: 'file with two lines', env: {}, fileContent: '2.5.8\n2.5.9\n', error: [/cwf\.version/] },
      {
        name: 'file with non-ASCII digits',
        env: {},
        fileContent: '٢.٥.٨',
        error: [/٢\.٥\.٨/, /cwf\.version/],
      },
      {
        name: 'invalid override never falls back to file',
        env: { CWF_VERSION: 'latest' },
        fileContent: '2.5.8',
        error: [/latest/, /CWF_VERSION/],
      },
      { name: 'no override and no file', env: {}, error: [/cwf\.version/, /CWF_VERSION/] },
      { name: 'empty override and no file', env: { CWF_VERSION: '' }, error: [/cwf\.version/, /CWF_VERSION/] },
      { name: 'blank override and no file', env: { CWF_VERSION: '  ' }, error: [/cwf\.version/, /CWF_VERSION/] },
    ];

    for (const testCase of cases) {
      writePinFile(pinFile, testCase.fileContent);
      if (testCase.error) {
        assertResolveError(testCase, pinFile);
      } else {
        assert.strictEqual(updateCwf.resolveVersion(testCase.env, pinFile), testCase.expected, testCase.name);
      }
    }
  });

  test('file errors name the file path and override errors name CWF_VERSION', () => {
    fs.writeFileSync(pinFile, 'latest', 'utf8');
    assert.throws(
      () => updateCwf.resolveVersion({}, pinFile),
      (err: Error) => err.message.includes(pinFile),
    );
    assert.throws(
      () => updateCwf.resolveVersion({ CWF_VERSION: 'latest' }, pinFile),
      (err: Error) => err.message.includes('CWF_VERSION') && !err.message.includes(pinFile),
    );
  });

  test('parseVersion strips the prefix and reports the cleaned text and source', () => {
    assert.strictEqual(updateCwf.parseVersion('\uFEFF v1.2.3 \r\n', 'somewhere'), '1.2.3');
    assert.throws(
      () => updateCwf.parseVersion('\uFEFF 1.2\r\n', 'somewhere'),
      (err: Error) => err.message.includes('"1.2"') && err.message.includes('somewhere'),
    );
  });

  suite('asset selection', () => {
    const fixturesDir = path.join(__dirname, '../../../src/test/fixtures');
    const readRelease = () => JSON.parse(fs.readFileSync(path.join(fixturesDir, 'cwf-release.json'), 'utf8'));

    test('assetName and releaseTag build the names from the bare version', () => {
      assert.strictEqual(updateCwf.assetName('2.5.8'), 'cs-webview-v2.5.8.zip');
      assert.strictEqual(updateCwf.releaseTag('2.5.8'), 'v2.5.8');
    });

    test('fixture is a v2.5.8 release with API urls on every asset', () => {
      const release = readRelease();
      assert.strictEqual(release.tag_name, 'v2.5.8');
      assert.strictEqual(release.draft, false);
      assert.strictEqual(release.prerelease, false);
      assert.ok(release.assets.length >= 3);
      for (const asset of release.assets) {
        assert.match(
          asset.url,
          /^https:\/\/api\.github\.com\/repos\/empear-analytics\/cs-webview\/releases\/assets\/\d+$/,
        );
        assert.ok(asset.name);
        assert.ok(asset.browser_download_url);
      }
    });

    test('selectAsset returns the exact-name asset whatever the draft and prerelease flags', () => {
      const flags = [
        { draft: false, prerelease: false },
        { draft: true, prerelease: false },
        { draft: false, prerelease: true },
        { draft: true, prerelease: true },
      ];
      const expectedUrl = readRelease().assets.find((a: { name: string }) => a.name === 'cs-webview-v2.5.8.zip').url;
      for (const flag of flags) {
        const release = { ...readRelease(), ...flag };
        const asset = updateCwf.selectAsset(release, '2.5.8');
        const label = JSON.stringify(flag);
        assert.strictEqual(asset.name, 'cs-webview-v2.5.8.zip', label);
        assert.strictEqual(asset.url, expectedUrl, label);
      }
    });

    test('selectAsset picks the matching asset for another version in the same release', () => {
      const asset = updateCwf.selectAsset(readRelease(), '2.5.7');
      assert.strictEqual(asset.name, 'cs-webview-v2.5.7.zip');
    });

    test('selectAsset does not match the checksum asset or a name prefix', () => {
      const release = { assets: [{ name: 'cs-webview-v2.5.8.zip.sha256', url: 'u' }] };
      assert.throws(() => updateCwf.selectAsset(release, '2.5.8'), /cs-webview-v2\.5\.8\.zip/);
    });

    test('selectAsset fails naming the asset and the tag when nothing matches', () => {
      const fixture = readRelease();
      const cases = [
        { name: 'version missing from fixture', release: fixture, version: '2.5.9' },
        { name: 'empty assets', release: { ...fixture, assets: [] }, version: '2.5.8' },
        { name: 'assets missing', release: { tag_name: 'v2.5.8' }, version: '2.5.8' },
        { name: 'assets null', release: { ...fixture, assets: null }, version: '2.5.8' },
        { name: 'release null', release: null, version: '2.5.8' },
      ];
      for (const testCase of cases) {
        assert.throws(
          () => updateCwf.selectAsset(testCase.release, testCase.version),
          (err: Error) => {
            assert.ok(err instanceof Error, testCase.name);
            assert.ok(err.message.includes(`cs-webview-v${testCase.version}.zip`), testCase.name);
            assert.ok(err.message.includes(`v${testCase.version}`), testCase.name);
            return true;
          },
          testCase.name,
        );
      }
    });
  });

  suite('extraction and stamp', () => {
    const fixturesDir = path.join(__dirname, '../../../src/test/fixtures');
    const releaseZip = path.join(fixturesDir, 'cwf-release.zip');
    const missingIndexJsZip = path.join(fixturesDir, 'cwf-release-missing-index-js.zip');
    let targetDir: string;

    const populate = (dir: string, files: string[]) => {
      for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), 'x');
      }
    };

    setup(() => {
      targetDir = path.join(tempDir, 'cs-cwf');
    });

    test('exports the required files and the stamp file name', () => {
      assert.deepStrictEqual(updateCwf.requiredFiles, ['index.html', 'assets/index.js']);
      assert.strictEqual(updateCwf.stampFileName, '.cwf-version');
    });

    test('writeStamp writes the value and a newline, readStamp returns it trimmed', () => {
      fs.mkdirSync(targetDir);
      updateCwf.writeStamp(targetDir, '2.5.8');
      assert.strictEqual(fs.readFileSync(path.join(targetDir, '.cwf-version'), 'utf8'), '2.5.8\n');
      assert.strictEqual(updateCwf.readStamp(targetDir), '2.5.8');
      fs.writeFileSync(path.join(targetDir, '.cwf-version'), '  local \r\n');
      assert.strictEqual(updateCwf.readStamp(targetDir), 'local');
    });

    test('readStamp returns undefined without a stamp or a directory', () => {
      assert.strictEqual(updateCwf.readStamp(targetDir), undefined);
      fs.mkdirSync(targetDir);
      assert.strictEqual(updateCwf.readStamp(targetDir), undefined);
    });

    test('extractCwf replaces the target with the archive contents and drops stray files and the stamp', async () => {
      populate(targetDir, ['stray.txt', 'assets/old.js']);
      updateCwf.writeStamp(targetDir, '2.5.7');

      await updateCwf.extractCwf(releaseZip, targetDir);

      for (const file of ['index.html', 'assets/index.js', 'assets/index.css']) {
        assert.ok(fs.statSync(path.join(targetDir, file)).isFile(), file);
      }
      assert.ok(fs.statSync(path.join(targetDir, 'assets')).isDirectory());
      assert.strictEqual(fs.existsSync(path.join(targetDir, 'stray.txt')), false);
      assert.strictEqual(fs.existsSync(path.join(targetDir, 'assets/old.js')), false);
      assert.strictEqual(updateCwf.readStamp(targetDir), undefined);
    });

    test('extractCwf creates a target directory that does not exist yet', async () => {
      const nested = path.join(tempDir, 'a', 'b', 'cs-cwf');
      await updateCwf.extractCwf(releaseZip, nested);
      assert.ok(fs.existsSync(path.join(nested, 'assets/index.js')));
    });

    test('extractCwf rejects naming the missing file and leaves no stamp', async () => {
      populate(targetDir, ['stray.txt']);
      updateCwf.writeStamp(targetDir, '2.5.7');

      await assert.rejects(updateCwf.extractCwf(missingIndexJsZip, targetDir), (err: Error) => {
        assert.ok(err.message.includes('cs-cwf/assets/index.js'), err.message);
        assert.ok(!err.message.includes('cs-cwf/index.html'), err.message);
        return true;
      });
      assert.strictEqual(updateCwf.readStamp(targetDir), undefined);
      assert.strictEqual(fs.existsSync(path.join(targetDir, '.cwf-version')), false);
    });

    test('extractCwf rejects and leaves no stamp when the zip does not exist', async () => {
      populate(targetDir, ['stray.txt']);
      updateCwf.writeStamp(targetDir, '2.5.7');
      await assert.rejects(updateCwf.extractCwf(path.join(tempDir, 'missing.zip'), targetDir));
      assert.strictEqual(updateCwf.readStamp(targetDir), undefined);
    });

    test('isUpToDate requires a matching stamp and every required file', () => {
      type Case = { name: string; stamp?: string; files: string[]; version: string; expected: boolean };
      const all = ['index.html', 'assets/index.js'];
      const cases: Case[] = [
        {
          name: 'stamp equals version with required files',
          stamp: '2.5.8',
          files: all,
          version: '2.5.8',
          expected: true,
        },
        { name: 'stamp differs', stamp: '2.5.7', files: all, version: '2.5.8', expected: false },
        { name: 'stamp local', stamp: 'local', files: all, version: '2.5.8', expected: false },
        { name: 'assets/index.js deleted', stamp: '2.5.8', files: ['index.html'], version: '2.5.8', expected: false },
        { name: 'index.html deleted', stamp: '2.5.8', files: ['assets/index.js'], version: '2.5.8', expected: false },
        { name: 'no stamp', files: all, version: '2.5.8', expected: false },
        { name: 'no directory content', stamp: '2.5.8', files: [], version: '2.5.8', expected: false },
      ];
      for (const testCase of cases) {
        const dir = fs.mkdtempSync(path.join(tempDir, 'case-'));
        populate(dir, testCase.files);
        if (testCase.stamp !== undefined) {
          updateCwf.writeStamp(dir, testCase.stamp);
        }
        assert.strictEqual(updateCwf.isUpToDate(dir, testCase.version), testCase.expected, testCase.name);
      }
    });

    test('isUpToDate is false for a directory that does not exist', () => {
      assert.strictEqual(updateCwf.isUpToDate(targetDir, '2.5.8'), false);
    });
  });
  suite('pinned download', () => {
    const fixturesDir = path.join(__dirname, '../../../src/test/fixtures');
    const releaseJson = fs.readFileSync(path.join(fixturesDir, 'cwf-release.json'), 'utf8');
    const releaseZipBytes = fs.readFileSync(path.join(fixturesDir, 'cwf-release.zip'));
    const assetUrl = JSON.parse(releaseJson).assets.find(
      (asset: { name: string }) => asset.name === 'cs-webview-v2.5.8.zip',
    ).url;
    const lookupUrl = 'https://api.github.com/repos/empear-analytics/cs-webview/releases/tags/v2.5.8';
    const token = 'ghp_secret-token-value';
    let targetDir: string;
    let calls: { url: string; init: any }[];
    let logs: string[];
    let tmpdirBefore: string[];

    const fakeFetch = (lookupStatus = 200, downloadStatus = 200) => {
      return async (url: string, init: any) => {
        calls.push({ url, init });
        if (url.includes('/releases/tags/')) {
          return new Response(lookupStatus === 200 ? releaseJson : 'nope', { status: lookupStatus });
        }
        return new Response(downloadStatus === 200 ? releaseZipBytes : 'nope', { status: downloadStatus });
      };
    };

    const run = (env: Record<string, string | undefined>, fetchImpl: any = fakeFetch()) =>
      updateCwf.fetchPinned({
        env,
        pinPath: pinFile,
        targetDir,
        fetchImpl,
        log: (message: string) => logs.push(message),
      });

    const cwfTempDirs = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('cs-cwf-'));
    const headersOf = (call: { init: any }) => new Headers(call.init.headers);

    const populateOldTarget = () => {
      fs.mkdirSync(path.join(targetDir, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'index.html'), 'old html');
      fs.writeFileSync(path.join(targetDir, 'assets/index.js'), 'old js');
      updateCwf.writeStamp(targetDir, '2.5.7');
    };

    const assertOldTargetUntouched = () => {
      assert.strictEqual(fs.readFileSync(path.join(targetDir, 'index.html'), 'utf8'), 'old html');
      assert.strictEqual(fs.readFileSync(path.join(targetDir, 'assets/index.js'), 'utf8'), 'old js');
      assert.strictEqual(updateCwf.readStamp(targetDir), '2.5.7');
    };

    setup(() => {
      targetDir = path.join(tempDir, 'cs-cwf');
      fs.writeFileSync(pinFile, '2.5.8\n');
      calls = [];
      logs = [];
      tmpdirBefore = cwfTempDirs();
    });

    test('downloads the pinned release, extracts it and stamps the version', async () => {
      await run({ GITHUB_TOKEN: token });

      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].url, lookupUrl);
      assert.strictEqual(headersOf(calls[0]).get('Authorization'), `token ${token}`);
      assert.strictEqual(headersOf(calls[0]).get('Accept'), 'application/vnd.github+json');
      assert.strictEqual(headersOf(calls[0]).get('User-Agent'), 'codescene-vscode-update-cwf');
      assert.strictEqual(calls[1].url, assetUrl);
      assert.strictEqual(headersOf(calls[1]).get('Accept'), 'application/octet-stream');
      assert.strictEqual(headersOf(calls[1]).get('Authorization'), `token ${token}`);
      assert.strictEqual(headersOf(calls[1]).get('User-Agent'), 'codescene-vscode-update-cwf');
      for (const file of ['index.html', 'assets/index.js', 'assets/index.css']) {
        assert.ok(fs.statSync(path.join(targetDir, file)).isFile(), file);
      }
      assert.strictEqual(updateCwf.readStamp(targetDir), '2.5.8');
      assert.ok(updateCwf.isUpToDate(targetDir, '2.5.8'));
    });

    test('CWF_VERSION selects the tag to look up', async () => {
      await assert.rejects(run({ GITHUB_TOKEN: token, CWF_VERSION: 'v9.9.9' }, fakeFetch(404)), /v9\.9\.9/);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, lookupUrl.replace('v2.5.8', 'v9.9.9'));
    });

    test('a second run on an up-to-date target needs no token and makes no request', async () => {
      await run({ GITHUB_TOKEN: token });
      calls = [];
      logs = [];

      await run({});

      assert.strictEqual(calls.length, 0);
      assert.ok(
        logs.some((line) => /already present/.test(line) && line.includes('2.5.8')),
        logs.join('\n'),
      );
    });

    test('a changed pin looks up the new tag over a stamped target', async () => {
      await run({ GITHUB_TOKEN: token });
      fs.writeFileSync(pinFile, '2.5.7\n');
      calls = [];

      await assert.rejects(run({ GITHUB_TOKEN: token }, fakeFetch(404)), /v2\.5\.7/);

      assert.strictEqual(calls.length, 1);
    });

    test('a locally built target is replaced by the pinned download', async () => {
      const buildDir = path.join(tempDir, 'build');
      fs.mkdirSync(path.join(buildDir, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(buildDir, 'index.html'), 'x');
      fs.writeFileSync(path.join(buildDir, 'assets/index.js'), 'x');
      updateCwf.copyLocalBuild(buildDir, targetDir);

      await run({ GITHUB_TOKEN: token });

      assert.strictEqual(calls.length, 2);
      assert.strictEqual(updateCwf.readStamp(targetDir), '2.5.8');
    });

    test('fails with a message that names the cause', async () => {
      type Case = {
        name: string;
        env: Record<string, string | undefined>;
        lookupStatus?: number;
        downloadStatus?: number;
        messagePatterns: RegExp[];
        expectedCalls: number;
      };
      const withToken = { GITHUB_TOKEN: token };
      const cases: Case[] = [
        { name: 'no token', env: {}, messagePatterns: [/GITHUB_TOKEN/], expectedCalls: 0 },
        { name: 'empty token', env: { GITHUB_TOKEN: '' }, messagePatterns: [/GITHUB_TOKEN/], expectedCalls: 0 },
        { name: 'blank token', env: { GITHUB_TOKEN: '  ' }, messagePatterns: [/GITHUB_TOKEN/], expectedCalls: 0 },
        { name: 'lookup 404', env: withToken, lookupStatus: 404, messagePatterns: [/v2\.5\.8/], expectedCalls: 1 },
        {
          name: 'lookup 401',
          env: withToken,
          lookupStatus: 401,
          messagePatterns: [/401/, /empear-analytics\/cs-webview/],
          expectedCalls: 1,
        },
        {
          name: 'lookup 403',
          env: withToken,
          lookupStatus: 403,
          messagePatterns: [/403/, /release lookup/, /empear-analytics\/cs-webview/],
          expectedCalls: 1,
        },
        {
          name: 'lookup 500',
          env: withToken,
          lookupStatus: 500,
          messagePatterns: [/500/, /release lookup/],
          expectedCalls: 1,
        },
        {
          name: 'download 403',
          env: withToken,
          downloadStatus: 403,
          messagePatterns: [/403/, /asset download/, /empear-analytics\/cs-webview/],
          expectedCalls: 2,
        },
        {
          name: 'download 404',
          env: withToken,
          downloadStatus: 404,
          messagePatterns: [/404/, /asset download/],
          expectedCalls: 2,
        },
        {
          name: 'download 500',
          env: withToken,
          downloadStatus: 500,
          messagePatterns: [/500/, /asset download/],
          expectedCalls: 2,
        },
        {
          name: 'invalid CWF_VERSION',
          env: { ...withToken, CWF_VERSION: 'latest' },
          messagePatterns: [/latest/, /CWF_VERSION/],
          expectedCalls: 0,
        },
      ];
      for (const testCase of cases) {
        calls = [];
        await assert.rejects(
          run(testCase.env, fakeFetch(testCase.lookupStatus, testCase.downloadStatus)),
          (err: Error) => {
            for (const pattern of testCase.messagePatterns) {
              assert.match(err.message, pattern, testCase.name);
            }
            assert.ok(!err.message.includes(token), testCase.name);
            return true;
          },
          testCase.name,
        );
        assert.strictEqual(calls.length, testCase.expectedCalls, testCase.name);
        assert.strictEqual(fs.existsSync(targetDir), false, testCase.name);
      }
    });

    test('a release without the pinned asset fails naming the asset and does not download', async () => {
      const noAssets = async (url: string, init: any) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ tag_name: 'v2.5.8', assets: [] }), { status: 200 });
      };

      await assert.rejects(run({ GITHUB_TOKEN: token }, noAssets), /cs-webview-v2\.5\.8\.zip/);

      assert.strictEqual(calls.length, 1);
    });

    test('a failed download leaves an existing target and its stamp untouched', async () => {
      populateOldTarget();

      await assert.rejects(run({ GITHUB_TOKEN: token }, fakeFetch(200, 500)), /500/);

      assertOldTargetUntouched();
    });

    test('a failed lookup leaves an existing target and its stamp untouched', async () => {
      populateOldTarget();

      await assert.rejects(run({ GITHUB_TOKEN: token }, fakeFetch(404)), /v2\.5\.8/);

      assertOldTargetUntouched();
    });

    test('an unusable archive fails and leaves no stamp', async () => {
      const badZip = async (url: string, init: any) => {
        calls.push({ url, init });
        return url.includes('/releases/tags/')
          ? new Response(releaseJson, { status: 200 })
          : new Response(Buffer.from('not a zip'), { status: 200 });
      };

      await assert.rejects(run({ GITHUB_TOKEN: token }, badZip));

      assert.strictEqual(updateCwf.readStamp(targetDir), undefined);
      assert.strictEqual(updateCwf.isUpToDate(targetDir, '2.5.8'), false);
    });

    test('the token never reaches the log', async () => {
      await run({ GITHUB_TOKEN: token });
      fs.rmSync(targetDir, { recursive: true, force: true });
      await run({ GITHUB_TOKEN: token }, fakeFetch(404)).catch(() => undefined);
      await run({ GITHUB_TOKEN: token }, fakeFetch(200, 403)).catch(() => undefined);
      await run({ GITHUB_TOKEN: token });
      await run({ GITHUB_TOKEN: token });

      assert.ok(logs.length > 0);
      for (const line of logs) {
        assert.ok(!line.includes(token), line);
      }
    });

    test('the temporary download directory is removed on success and on failure', async () => {
      await run({ GITHUB_TOKEN: token });
      fs.rmSync(targetDir, { recursive: true, force: true });
      await run({ GITHUB_TOKEN: token }, fakeFetch(200, 500)).catch(() => undefined);

      assert.deepStrictEqual(
        cwfTempDirs().filter((name) => !tmpdirBefore.includes(name)),
        [],
      );
    });
  });

  suite('local build', () => {
    test('shouldBuildLocally needs the sibling directory and no CI', () => {
      type Case = { name: string; dirExists: boolean; CI?: string; expected: boolean };
      const cases: Case[] = [
        { name: 'dir exists, CI unset', dirExists: true, expected: true },
        { name: 'dir exists, CI empty', dirExists: true, CI: '', expected: true },
        { name: 'dir exists, CI=1', dirExists: true, CI: '1', expected: false },
        { name: 'dir exists, CI=true', dirExists: true, CI: 'true', expected: false },
        { name: 'dir missing, CI unset', dirExists: false, expected: false },
        { name: 'dir missing, CI=1', dirExists: false, CI: '1', expected: false },
      ];
      for (const testCase of cases) {
        const localDir = path.join(tempDir, 'cs-webview');
        fs.rmSync(localDir, { recursive: true, force: true });
        if (testCase.dirExists) {
          fs.mkdirSync(localDir);
        }
        const env = testCase.CI === undefined ? {} : { CI: testCase.CI };
        assert.strictEqual(updateCwf.shouldBuildLocally(env, localDir), testCase.expected, testCase.name);
      }
    });

    test('copyLocalBuild replaces the target with the build output and stamps it local', () => {
      const buildDir = path.join(tempDir, 'build');
      const target = path.join(tempDir, 'cs-cwf');
      fs.mkdirSync(path.join(buildDir, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(buildDir, 'index.html'), 'html');
      fs.writeFileSync(path.join(buildDir, 'assets/index.js'), 'js');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'stray.txt'), 'x');
      updateCwf.writeStamp(target, '2.5.8');

      updateCwf.copyLocalBuild(buildDir, target);

      assert.strictEqual(fs.readFileSync(path.join(target, 'index.html'), 'utf8'), 'html');
      assert.strictEqual(fs.readFileSync(path.join(target, 'assets/index.js'), 'utf8'), 'js');
      assert.strictEqual(fs.existsSync(path.join(target, 'stray.txt')), false);
      assert.strictEqual(updateCwf.readStamp(target), 'local');
      assert.strictEqual(updateCwf.isUpToDate(target, '2.5.8'), false);
    });
  });
});
