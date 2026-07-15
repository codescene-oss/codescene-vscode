// Exercises ACE guard early-return paths when BUILD_NO_ACE=true (pass 2 of test:coverage:dual).
import * as assert from 'assert';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { createTestDir, ensureBinary } from '../integration_helper';
import { noAceSuite } from '../ace-test-suite';

noAceSuite('DevtoolsAPI no-ACE guard Test Suite', () => {
  const testDir = createTestDir('test-devtools-api-no-ace');

  setup(async function () {
    this.timeout(60000);
    mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);
    const binaryPath = await ensureBinary();
    const mockContext = createMockExtensionContext(testDir);
    DevtoolsAPI.init(binaryPath, mockContext, async () => false);
  });

  teardown(() => {
    restoreDefaultWorkspaceFolders();
  });

  test('preflight returns immediately when ACE is disabled', async function () {
    const response = await DevtoolsAPI.preflight();
    assert.strictEqual(response, undefined);
  });

  test('aceEnabled returns false when ACE is disabled', () => {
    assert.strictEqual(DevtoolsAPI.aceEnabled(), false);
  });

  test('disableAce is a no-op when ACE is disabled', () => {
    DevtoolsAPI.disableAce();
    assert.strictEqual(DevtoolsAPI.aceEnabled(), false);
  });
});
