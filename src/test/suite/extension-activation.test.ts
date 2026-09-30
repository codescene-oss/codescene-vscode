import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CsExtensionState } from '../../cs-extension-state';
import { DevtoolsAPI } from '../../devtools-api';
import { activate, deactivate } from '../../extension-impl';
import { createMockExtensionContext } from '../mocks/mock-extension-context';

function projectRoot(): string {
  return path.join(__dirname, '../../..');
}

function createActivationContext(extensionPath?: string) {
  const context = createMockExtensionContext(extensionPath ?? projectRoot());
  if (extensionPath) {
    (context as any).extensionPath = extensionPath;
  }
  (context as any).extension = {
    id: 'CodeScene.codescene-vscode',
    packageJSON: { version: '0.28.2' },
  };
  (context as any).workspaceState = {
    get: () => undefined,
    update: async () => {},
  };
  (context as any).secrets = {
    get: async () => undefined,
    store: async () => {},
    delete: async () => {},
  };
  return context;
}

suite('Extension Activation Test Suite', function () {
  this.timeout(60000);

  teardown(() => {
    try {
      deactivate();
    } catch {
      DevtoolsAPI.dispose();
    }
  });

  test('activate reports an error when the bundled distribution is missing', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescene-activate-missing-'));
    try {
      await activate(createActivationContext(emptyDir));
      assert.strictEqual(CsExtensionState.stateProperties.features.analysis.state, 'error');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('activate shows UI then finishes background startup', async () => {
    await activate(createActivationContext());
    const analysis = CsExtensionState.stateProperties.features.analysis;
    assert.strictEqual(analysis.state, 'enabled', analysis.error?.message);
  });

  test('activate keeps the error state when the IDE server version does not match', async () => {
    const previous = process.env.CS_IDE_REQUIRED_VERSION;
    process.env.CS_IDE_REQUIRED_VERSION = 'not-the-required-sha';
    try {
      await activate(createActivationContext());
      assert.strictEqual(CsExtensionState.stateProperties.features.analysis.state, 'error');
    } finally {
      if (previous === undefined) {
        delete process.env.CS_IDE_REQUIRED_VERSION;
      } else {
        process.env.CS_IDE_REQUIRED_VERSION = previous;
      }
    }
  });
});
