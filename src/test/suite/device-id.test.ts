import * as assert from 'assert';
import * as fs from 'fs';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { createTestDir, ensureBinary } from '../integration_helper';

suite('Device ID Integration Test Suite', () => {
  const testDir = createTestDir('test-device-id');

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

  test('getDeviceId returns a non-empty string', async function() {
    this.timeout(10000);

    const deviceId = await DevtoolsAPI.getDeviceId();

    assert.ok(deviceId, 'Device ID should be returned');
    assert.strictEqual(typeof deviceId, 'string', 'Device ID should be a string');
    assert.ok(deviceId.trim().length > 0, 'Device ID should not be empty');
    assert.match(deviceId, /^[a-f0-9]{32}$/, 'Device ID should be a 32-character hexadecimal string');
  });

  test('getDeviceId returns consistent value across calls', async function() {
    this.timeout(10000);

    const deviceId1 = await DevtoolsAPI.getDeviceId();
    const deviceId2 = await DevtoolsAPI.getDeviceId();

    assert.strictEqual(deviceId1, deviceId2, 'Device ID should be consistent across calls');
  });
});
