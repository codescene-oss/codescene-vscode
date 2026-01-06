import * as assert from 'assert';
import * as fs from 'fs';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { TelemetryEvent, TelemetryResponse } from '../../devtools-api/telemetry-model';
import { createTestDir, ensureBinary } from '../integration_helper';

suite('Telemetry Integration Test Suite', () => {
  const testDir = createTestDir('test-telemetry');

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
  });

  teardown(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });

  test('postTelemetry sends basic event', async function() {
    this.timeout(10000);

    const event: TelemetryEvent = {
      'editor-type': 'VSCode',
      'event-name': 'test-event',
      'extension-version': '1.0.0'
    };

    const response = await DevtoolsAPI.postTelemetry(event);

    assert.ok(response, 'Response should be defined');
    assert.ok('status' in response, 'Response should have status property');
    assert.strictEqual(typeof response.status, 'number', 'Status should be a number');
  });

  test('postTelemetry sends event with user id', async function() {
    this.timeout(10000);

    const event: TelemetryEvent = {
      'editor-type': 'VSCode',
      'event-name': 'test-event-with-user',
      'extension-version': '1.0.0',
      'user-id': 'test-user-123'
    };

    const response = await DevtoolsAPI.postTelemetry(event);

    assert.ok(response, 'Response should be defined');
    assert.strictEqual(typeof response.status, 'number', 'Status should be a number');
  });

  test('postTelemetry sends event with custom properties', async function() {
    this.timeout(10000);

    const event: TelemetryEvent = {
      'editor-type': 'VSCode',
      'event-name': 'custom-props-event',
      'extension-version': '1.0.0',
      'custom-prop-1': 'value1',
      'custom-prop-2': 42,
      'custom-prop-3': true
    };

    const response = await DevtoolsAPI.postTelemetry(event);

    assert.ok(response, 'Response should be defined');
    assert.strictEqual(typeof response.status, 'number', 'Status should be a number');
  });

  test('postTelemetry sends event with all properties', async function() {
    this.timeout(10000);

    const event: TelemetryEvent = {
      'editor-type': 'VSCode',
      'event-name': 'comprehensive-event',
      'extension-version': '2.5.0',
      internal: false,
      'user-id': 'user-456',
      timestamp: new Date().toISOString(),
      action: 'click',
      feature: 'refactoring',
      duration: 1234
    };

    const response = await DevtoolsAPI.postTelemetry(event);

    assert.ok(response, 'Response should be defined');
    assert.strictEqual(typeof response.status, 'number', 'Status should be a number');
  });
});
