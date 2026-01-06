import * as assert from 'assert';
import * as fs from 'fs';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { createTestDir, ensureBinary } from '../integration_helper';

suite('Preflight Integration Test Suite', () => {
  const testDir = createTestDir('test-preflight');
  let preflightStateChangeFired = false;
  let lastPreflightState: any;
  let stateChangeListener: any;

  function waitForEvent(ms: number = 1000): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function assertPreflightResponseStructure(response: any) {
    assert.ok(response, 'Response should exist');
    assert.ok('version' in response);
    assert.ok('language-common' in response);
    assert.ok('language-specific' in response);
    assert.ok('file-types' in response);

    assert.ok(response['language-common'], 'language-common should exist');
    assert.ok('max-input-loc' in response['language-common']);
    assert.ok('code-smells' in response['language-common']);
    assert.ok(Array.isArray(response['language-common']['code-smells']));
    assert.ok(Array.isArray(response['file-types']));
  }

  setup(async function() {
    this.timeout(60000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);

    const binaryPath = await ensureBinary();
    const mockContext = createMockExtensionContext(testDir);

    DevtoolsAPI.init(binaryPath, mockContext);

    preflightStateChangeFired = false;
    lastPreflightState = undefined;

    stateChangeListener = DevtoolsAPI.onDidChangePreflightState((state) => {
      preflightStateChangeFired = true;
      lastPreflightState = state;
    });
  });

  teardown(() => {
    stateChangeListener?.dispose();

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });

  test('preflight returns expected response structure', async function() {
    this.timeout(60000);

    const response = await DevtoolsAPI.preflight();

    assertPreflightResponseStructure(response);
    assert.ok(response, 'Response should exist');
    assert.strictEqual(response.version, 2.0);
    assert.ok(response['language-common']['max-input-loc'] > 0);
    assert.ok(response['language-common']['code-smells'].length > 0);
    assert.ok(response['file-types'].length > 0);
  });

  test('preflight fires state change event with loading state', async function() {
    this.timeout(60000);

    preflightStateChangeFired = false;
    lastPreflightState = undefined;

    const preflightPromise = DevtoolsAPI.preflight();

    await waitForEvent(100);

    assert.ok(preflightStateChangeFired, 'Preflight state change event should fire');
    assert.ok(lastPreflightState, 'Last preflight state should be captured');

    await preflightPromise;
  });

  test('preflight fires state change event with enabled state on success', async function() {
    this.timeout(60000);

    const initialStateChangeFired = preflightStateChangeFired;
    const initialState = lastPreflightState;
    assert.strictEqual(initialStateChangeFired, false, 'State change event should not have fired initially');
    assert.strictEqual(initialState, undefined, 'Last preflight state should be undefined initially');

    await DevtoolsAPI.preflight();

    await waitForEvent(100);

    assert.strictEqual(preflightStateChangeFired, true, 'Preflight state change event should fire');
    assert.ok(lastPreflightState, 'Last preflight state should be captured');
    assert.strictEqual(lastPreflightState.state, 'enabled');
  });

  test('preflight enables ACE when successful', async function() {
    this.timeout(60000);

    const initialAceState = DevtoolsAPI.aceEnabled();
    assert.strictEqual(initialAceState, false, 'ACE should be disabled initially');

    await DevtoolsAPI.preflight();

    await waitForEvent(100);

    const finalAceState = DevtoolsAPI.aceEnabled();

    assert.strictEqual(finalAceState, true, 'ACE should be enabled after successful preflight');
  });

  test('preflight contains expected code smells', async function() {
    this.timeout(60000);

    const response = await DevtoolsAPI.preflight();

    assert.ok(response, 'Response should exist');
    const codeSmells = response['language-common']['code-smells'];
    assert.ok(codeSmells.includes('Complex Conditional'));
    assert.ok(codeSmells.includes('Complex Method'));
    assert.ok(codeSmells.includes('Large Method'));
  });

  test('preflight contains expected file types', async function() {
    this.timeout(60000);

    const response = await DevtoolsAPI.preflight();

    assert.ok(response, 'Response should exist');
    const fileTypes = response['file-types'];
    assert.ok(fileTypes.includes('cpp'));
    assert.ok(fileTypes.includes('java'));
    assert.ok(fileTypes.includes('js'));
    assert.ok(fileTypes.includes('ts'));
  });
});
