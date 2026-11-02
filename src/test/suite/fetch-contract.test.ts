import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const cliConfig = require('../../../scripts/cli-config');
const { fetchContract } = require('../../../scripts/fetch-contract');

const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'fetch-contract.js');

suite('Contract bundle fetch script Test Suite', () => {
  const directories: string[] = [];

  function tempDir(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fetch-contract-'));
    directories.push(directory);
    return directory;
  }

  function writeBundle(directory: string, omit: string[] = []) {
    const files: Record<string, string> = {
      'wire-manifest.json': '[]',
      'fixtures/index.json': '{}',
      'schemas/review.json': '{}',
    };
    for (const [name, content] of Object.entries(files)) {
      if (omit.includes(name)) continue;
      fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      fs.writeFileSync(path.join(directory, name), content);
    }
    return directory;
  }

  const neverDownload = () => Promise.reject(new Error('unexpected download'));

  teardown(() => {
    while (directories.length > 0) {
      fs.rmSync(directories.pop()!, { recursive: true, force: true });
    }
  });

  test('names the bundle zip after the pinned CLI SHA', () => {
    assert.strictEqual(cliConfig.contractArtifactName(), `cs-ide-contract-${cliConfig.requiredDevtoolsVersion}.zip`);
  });

  test('copies CS_IDE_CONTRACT_BUNDLE to cs-ide-contract/ without downloading, replacing a stale copy', async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'cs-ide-contract'));
    fs.writeFileSync(path.join(root, 'cs-ide-contract', 'stale.json'), '{}');
    const bundle = writeBundle(tempDir());

    await fetchContract({ env: { CS_IDE_CONTRACT_BUNDLE: bundle }, root, download: neverDownload });

    assert.ok(fs.existsSync(path.join(root, 'cs-ide-contract', 'wire-manifest.json')));
    assert.ok(fs.existsSync(path.join(root, 'cs-ide-contract', 'schemas', 'review.json')));
    assert.ok(!fs.existsSync(path.join(root, 'cs-ide-contract', 'stale.json')));
    assert.deepStrictEqual(fs.readdirSync(root), ['cs-ide-contract']);
  });

  test('accepts a CS_IDE_CONTRACT_BUNDLE that already is cs-ide-contract/', async () => {
    const root = tempDir();
    const bundle = writeBundle(path.join(root, 'cs-ide-contract'));
    await fetchContract({ env: { CS_IDE_CONTRACT_BUNDLE: bundle }, root, download: neverDownload });
    assert.ok(fs.existsSync(path.join(bundle, 'wire-manifest.json')));
  });

  test('fails on a CS_IDE_CONTRACT_BUNDLE that does not exist', async () => {
    const root = tempDir();
    await assert.rejects(
      fetchContract({ env: { CS_IDE_CONTRACT_BUNDLE: path.join(root, 'missing') }, root, download: neverDownload }),
      /does not exist/
    );
    assert.deepStrictEqual(fs.readdirSync(root), []);
  });

  for (const missing of ['wire-manifest.json', 'fixtures/index.json', 'schemas/review.json']) {
    test(`fails on a bundle without ${missing} and keeps the existing copy`, async () => {
      const root = tempDir();
      writeBundle(path.join(root, 'cs-ide-contract'));
      const bundle = writeBundle(tempDir(), [missing]);
      await assert.rejects(
        fetchContract({ env: { CS_IDE_CONTRACT_BUNDLE: bundle }, root, download: neverDownload }),
        /is not a contract bundle.*is missing/
      );

      assert.ok(fs.existsSync(path.join(root, 'cs-ide-contract', 'wire-manifest.json')));
      assert.ok(!fs.readdirSync(root).some((name) => name.startsWith('.temp-extract')));
    });
  }

  test('downloads the pinned bundle by its artifact name when no local bundle is set', async () => {
    const root = tempDir();
    const requested: string[] = [];
    const download = (artifactName: string) => {
      requested.push(artifactName);
      return Promise.reject(new Error('Download error: [404] Not Found'));
    };

    await assert.rejects(fetchContract({ env: {}, root, download }), /Download error: \[404\] Not Found/);

    assert.deepStrictEqual(requested, [cliConfig.contractArtifactName()]);
    assert.deepStrictEqual(fs.readdirSync(root), []);
  });

  test('fails and removes the zip when the downloaded archive cannot be extracted', async () => {
    const root = tempDir();
    const zipPath = path.join(root, cliConfig.contractArtifactName());
    const download = async () => {
      fs.writeFileSync(zipPath, 'this is not a zip archive');
      return zipPath;
    };

    await assert.rejects(fetchContract({ env: {}, root, download }));

    assert.deepStrictEqual(fs.readdirSync(root), []);
  });

  test('the script exits non-zero when the bundle cannot be fetched', () => {
    const missing = path.join(tempDir(), 'missing');
    const result = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, CS_IDE_CONTRACT_BUNDLE: missing },
      encoding: 'utf8',
    });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Failed to fetch the contract bundle/);
  });

  test('pretest fetches the bundle', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
    assert.strictEqual(packageJson.scripts['fetch-contract'], 'node ./scripts/fetch-contract.js');
    assert.match(packageJson.scripts.pretest, /npm run fetch-contract/);
  });

  test('both test jobs of the test workflow run pretest', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'test.yml'), 'utf8');
    const jobs = workflow.split(/^  (?=build:|test-no-ace:)/m).slice(1);
    assert.strictEqual(jobs.length, 2);
    for (const job of jobs) {
      assert.match(job, /run: npm run pretest/);
    }
  });
});
