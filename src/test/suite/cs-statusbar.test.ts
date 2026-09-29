import * as assert from 'assert';
import * as vscode from 'vscode';
import { CsStatusBar } from '../../cs-statusbar';
import { CsExtensionState } from '../../cs-extension-state';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';
import * as path from 'path';

suite('CsStatusBar automatic analysis', () => {
  let originalCreate: typeof vscode.window.createStatusBarItem;

  suiteSetup(() => {
    const testRepoPath = path.join(__dirname, '../../../test-statusbar-repo');
    if (!CsExtensionState.hasInstance) {
      CsExtensionState.init(createMockExtensionContext(testRepoPath));
    }
  });

  setup(() => {
    originalCreate = vscode.window.createStatusBarItem;
  });

  teardown(() => {
    vscode.window.createStatusBarItem = originalCreate;
    restoreDefaultConfiguration();
  });

  test('shows a stopped state that starts analysis on click', () => {
    mockConfiguration('codescene', { enableAutomaticAnalysis: false });
    const items: Array<{ text: string; tooltip: string; command: string; backgroundColor?: unknown }> = [];
    vscode.window.createStatusBarItem = (() => {
      const item = {
        text: '',
        tooltip: '',
        command: '',
        backgroundColor: undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined,
      };
      items.push(item);
      return item as any;
    }) as typeof vscode.window.createStatusBarItem;

    const bar = new CsStatusBar();
    bar.update();
    const analysis = items[items.length - 1];
    assert.strictEqual(analysis.text, '$(debug-pause) Analysis stopped');
    assert.strictEqual(analysis.command, 'codescene.startAutomaticAnalysis');
    bar.dispose();
  });
});
