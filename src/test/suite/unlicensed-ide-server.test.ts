import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { DevtoolsAPI } from '../../devtools-api';
import { CsIdeServerClient, isLicenseRequired, ReviewFailed } from '../../devtools-api/ide-server-client';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { getCapturedLogs } from '../setup';
import { createTestDir, ensureBinary } from '../integration_helper';
import { aceTest } from '../ace-test-suite';
import type { CsFeature } from '../../cs-extension-state';

const ISOLATED_ENV = ['CS_ACCESS_TOKEN', 'CS_CONTEXT', 'CODESCENE_HOME'] as const;

async function startUnlicensed(binaryPath: string, home: string): Promise<CsIdeServerClient> {
  const saved = ISOLATED_ENV.map((name) => [name, process.env[name]] as const);
  delete process.env.CS_ACCESS_TOKEN;
  delete process.env.CS_CONTEXT;
  process.env.CODESCENE_HOME = home;
  const client = CsIdeServerClient.fromDistribution(binaryPath);
  let started: Promise<unknown>;
  try {
    started = client.start();
  } finally {
    saved.forEach(([name, value]) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
  await started;
  return client;
}

suite('Unlicensed cs-ide Integration Test Suite', () => {
  const testDir = createTestDir('test-unlicensed-ide-server');
  const home = path.join(testDir, 'codescene-home');
  let client: CsIdeServerClient;

  setup(async function () {
    this.timeout(60000);
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(home, { recursive: true });
    client = await startUnlicensed(await ensureBinary(), home);
    DevtoolsAPI.init(client.binaryPath, createMockExtensionContext(testDir), client);
  });

  teardown(() => {
    client.dispose();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('refuses a review with auth/license-required without logging an error', async function () {
    this.timeout(60000);
    const content = 'int f(int a) { return a; }\n';

    await assert.rejects(client.review({ path: path.join(testDir, 'refused.cpp'), 'file-content': content }), (error) => {
      assert.ok(isLicenseRequired(error), `expected auth/license-required, got ${String(error)}`);
      return true;
    });
    await assert.rejects(DevtoolsAPI.codeHealthRulesTemplate(), (error) => isLicenseRequired(error));

    const loud = getCapturedLogs().filter(({ level, message }) => level === 'error' && message.includes('request failed'));
    assert.deepStrictEqual(loud, []);
  });

  test('answers reviewFiles with an id by reviewFailed auth/license-required', async function () {
    this.timeout(60000);
    const failure = new Promise<ReviewFailed>((resolve) => client.onDidReviewFailed(resolve));

    client.reviewFiles(testDir, [{ id: 'refused-1', relPath: 'refused.cpp', content: 'int f() { return 1; }\n' }]);

    const { id, code } = await failure;
    assert.deepStrictEqual({ id, code }, { id: 'refused-1', code: 'auth/license-required' });
  });

  aceTest('treats a refused preflight as refactoring being unavailable, not as an error', async function () {
    this.timeout(60000);
    const states: CsFeature['state'][] = [];
    const listener = DevtoolsAPI.onDidChangePreflightState(({ state }) => states.push(state));

    assert.strictEqual(await DevtoolsAPI.preflight(), undefined);
    listener.dispose();

    assert.deepStrictEqual(states, ['loading', 'disabled']);
    assert.deepStrictEqual(getCapturedLogs().filter(({ level }) => level === 'error'), []);
  });

  test('still answers device-id', async function () {
    this.timeout(60000);
    const deviceId = await DevtoolsAPI.getDeviceId();

    assert.ok(typeof deviceId === 'string' && deviceId.length > 0, `device id: ${deviceId}`);
  });
});
