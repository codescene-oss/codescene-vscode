import * as assert from 'assert';
import * as vscode from 'vscode';
import { reloadWindowForUpdate, migrationKey } from '../../extension-reload';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';

function createReloadContext(version: string) {
  const context = createMockExtensionContext('/test/reload-window');
  (context as any).extension = { packageJSON: { version } };
  return context;
}

suite('reloadWindowForUpdate Test Suite', () => {
  let originalCI: string | undefined;
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  const executedCommands: string[] = [];

  setup(() => {
    originalCI = process.env.CI;
    process.env.CI = 'true';
    executedCommands.length = 0;
    originalExecuteCommand = vscode.commands.executeCommand;
    vscode.commands.executeCommand = ((command: string) => {
      executedCommands.push(command);
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;
  });

  teardown(() => {
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
    vscode.commands.executeCommand = originalExecuteCommand;
    restoreDefaultConfiguration();
  });

  test('stores version in globalState without reload under CI', async () => {
    const context = createReloadContext('2.0.0');

    await reloadWindowForUpdate(context);

    assert.strictEqual(context.globalState.get<string>(migrationKey), '2.0.0');
    assert.ok(!executedCommands.includes('workbench.action.reloadWindow'));
  });

  test('skips reload when version unchanged outside CI', async () => {
    delete process.env.CI;
    const context = createReloadContext('2.0.0');
    await context.globalState.update(migrationKey, '2.0.0');

    await reloadWindowForUpdate(context);

    assert.ok(!executedCommands.includes('workbench.action.reloadWindow'));
  });

  test('skips reload when reloadOnUpdate is disabled', async () => {
    delete process.env.CI;
    mockConfiguration('codescene', { reloadOnUpdate: false });
    const context = createReloadContext('2.0.0');
    await context.globalState.update(migrationKey, '1.0.0');

    await reloadWindowForUpdate(context);

    assert.ok(!executedCommands.includes('workbench.action.reloadWindow'));
  });
});
