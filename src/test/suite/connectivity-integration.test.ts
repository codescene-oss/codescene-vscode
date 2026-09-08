import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { createTestDir } from '../integration_helper';
import * as configModule from '../../configuration';
import * as csExtensionState from '../../cs-extension-state';
import { testConnectivity } from '../../refactoring/connectivity';

import { aceSuite } from '../ace-test-suite';

aceSuite('Connectivity Integration Test Suite', () => {
  const testDir = createTestDir('test-connectivity-integration');
  const awsProfile = process.env.CS_AGENT_AWS_PROFILE;
  const awsRegion = process.env.CS_AGENT_AWS_REGION;
  let originalGetAuthToken: any;
  let originalGetExtensionPath: any;
  let originalGetProviderOptions: any;
  let originalGetAgentModel: any;

  if (!awsProfile || !awsRegion) {
    console.log(
      'Skipping Connectivity Integration tests: CS_AGENT_AWS_PROFILE and CS_AGENT_AWS_REGION environment variables not set'
    );
    return;
  }

  const projectRoot = path.join(__dirname, '..', '..', '..');
  const agentBinaryPath = path.join(projectRoot, 'bin', 'cs-agent');
  if (!fs.existsSync(agentBinaryPath)) {
    console.log('Skipping Connectivity Integration tests: cs-agent binary not found at ' + agentBinaryPath);
    return;
  }

  setup(async function () {
    this.timeout(60000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);

    originalGetAuthToken = configModule.getAuthToken;
    (configModule as any).getAuthToken = () => 'dummy-token';

    originalGetProviderOptions = configModule.getProviderOptions;
    (configModule as any).getProviderOptions = () => ({
      'amazon-bedrock:profile': awsProfile,
      'amazon-bedrock:region': awsRegion,
    });

    originalGetAgentModel = configModule.getAgentModel;
    (configModule as any).getAgentModel = () => 'amazon-bedrock/eu.anthropic.claude-sonnet-4-6';

    originalGetExtensionPath = csExtensionState.getExtensionPath;
    (csExtensionState as any).getExtensionPath = () => projectRoot;

    Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', {
      get: () => ({
        session: undefined,
        features: {
          analysis: { state: 'enabled' },
          ace: { state: 'enabled' },
        },
      }),
      configurable: true,
    });
  });

  teardown(() => {
    if (originalGetAuthToken) {
      (configModule as any).getAuthToken = originalGetAuthToken;
    }

    if (originalGetProviderOptions) {
      (configModule as any).getProviderOptions = originalGetProviderOptions;
    }

    if (originalGetAgentModel) {
      (configModule as any).getAgentModel = originalGetAgentModel;
    }

    if (originalGetExtensionPath) {
      (csExtensionState as any).getExtensionPath = originalGetExtensionPath;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });

  test('testConnectivity returns success with valid credentials', async function () {
    this.timeout(120000);

    const result = await testConnectivity({ timeoutMs: 90000 });

    assert.ok(result, 'Result should be defined');
    assert.strictEqual(result.success, true, `Connectivity should succeed but got error: ${result.error}`);
  });

  test('testConnectivity respects timeout option', async function () {
    this.timeout(10000);

    const result = await testConnectivity({ timeoutMs: 1 });

    assert.ok(result, 'Result should be defined');
    assert.strictEqual(result.success, false, 'Should fail due to timeout');
    assert.ok(
      result.error?.includes('timed out') || result.error?.includes('cancelled'),
      `Error should mention timeout or cancellation, got: ${result.error}`
    );
  });

  test('testConnectivity respects abort signal', async function () {
    this.timeout(10000);

    const abortController = new AbortController();

    const resultPromise = testConnectivity({ signal: abortController.signal });

    abortController.abort();

    const result = await resultPromise;

    assert.ok(result, 'Result should be defined');
    assert.strictEqual(result.success, false, 'Should fail due to abort');
    assert.ok(result.error?.includes('cancelled'), `Error should mention cancellation, got: ${result.error}`);
  });
});
