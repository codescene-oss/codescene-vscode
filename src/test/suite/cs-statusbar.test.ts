import * as assert from 'assert';
import * as vscode from 'vscode';
import { CsStatusBar } from '../../cs-statusbar';
import { CsExtensionState } from '../../cs-extension-state';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';

suite('CsStatusBar automatic analysis', () => {
  let originalCreate: typeof vscode.window.createStatusBarItem;
  let originalStateProperties: PropertyDescriptor | undefined;

  setup(() => {
    originalCreate = vscode.window.createStatusBarItem;
    originalStateProperties = Object.getOwnPropertyDescriptor(CsExtensionState, 'stateProperties');
    Object.defineProperty(CsExtensionState, 'stateProperties', {
      configurable: true,
      get: () => ({
        features: {
          analysis: { state: 'enabled' },
          ace: { state: 'enabled' },
        },
      }),
    });
  });

  teardown(() => {
    vscode.window.createStatusBarItem = originalCreate;
    restoreDefaultConfiguration();
    if (originalStateProperties) {
      Object.defineProperty(CsExtensionState, 'stateProperties', originalStateProperties);
    }
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
