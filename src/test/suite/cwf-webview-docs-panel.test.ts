import * as assert from 'assert';
import * as vscode from 'vscode';
import { CodeSceneCWFDocsTabPanel } from '../../codescene-tab/webview/documentation/cwf-webview-docs-panel';
import { CsExtensionState } from '../../cs-extension-state';
import { InteractiveDocsParams } from '../../documentation/commands';
import { TestTextDocument } from '../mocks/test-text-document';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import {
  getWebviewMessageHandler,
  getWebviewPostMessageCalls,
  resetWebviewPanelMocks,
} from '../setup';
import { aceSuite } from '../ace-test-suite';
import { initExtensionId } from '../../extension-id';

function resetDocsPanel() {
  const panelClass = CodeSceneCWFDocsTabPanel as unknown as { _instance?: CodeSceneCWFDocsTabPanel };
  panelClass._instance?.dispose();
  panelClass._instance = undefined;
}

function createDocsParams(): InteractiveDocsParams {
  const document = new TestTextDocument('/test/sample.cpp', 'int main() {}', 'cpp');
  return {
    document,
    issueInfo: { category: 'Complex Method' },
  };
}

suite('CodeSceneCWFDocsTabPanel Test Suite', () => {
  let mockContext: ReturnType<typeof createMockExtensionContext>;
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  const executedCommands: { command: string; args: unknown[] }[] = [];

  setup(() => {
    resetWebviewPanelMocks();
    resetDocsPanel();
    mockContext = createMockExtensionContext('/test/docs-panel');
    initExtensionId({ extension: { id: 'codescene.codescene-vscode' } } as vscode.ExtensionContext);
    CsExtensionState.init(mockContext);

    originalExecuteCommand = vscode.commands.executeCommand;
    executedCommands.length = 0;
    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      executedCommands.push({ command, args });
      if (command === 'workbench.action.openWorkspaceSettings') {
        return Promise.reject(new Error('No workspace settings'));
      }
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;
  });

  teardown(() => {
    resetDocsPanel();
    resetWebviewPanelMocks();
    vscode.commands.executeCommand = originalExecuteCommand;
  });

  function primeDocsPanel() {
    const panel = CodeSceneCWFDocsTabPanel.instance as any;
    panel.state = createDocsParams();
  }

  aceSuite('ACE state listeners', () => {
    test('refreshAceState posts update when ACE state changes', async () => {
      primeDocsPanel();
      getWebviewPostMessageCalls().length = 0;

      (CsExtensionState as any)._instance.aceStateChangedEmitter.fire();
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.ok(
        getWebviewPostMessageCalls().some(
          (msg: any) => msg?.messageType === 'update-renderer'
        ),
        'Expected update-renderer postMessage after ACE state change'
      );
    });
  });

  test('open-settings uses workspace settings when available', async () => {
    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      executedCommands.push({ command, args });
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;

    primeDocsPanel();
    const handler = getWebviewMessageHandler();
    assert.ok(handler, 'Expected webview message handler');

    await handler!({ messageType: 'open-settings' });

    assert.ok(
      executedCommands.some((c) => c.command === 'workbench.action.openWorkspaceSettings'),
      'Expected workspace settings command'
    );
    assert.strictEqual(executedCommands[0].args[0], '@ext:codescene.codescene-vscode');
  });

  test('open-settings falls back to user settings when workspace settings fail', async () => {
    primeDocsPanel();
    const handler = getWebviewMessageHandler();
    assert.ok(handler, 'Expected webview message handler');

    await handler!({ messageType: 'open-settings' });

    assert.ok(
      executedCommands.some((c) => c.command === 'workbench.action.openWorkspaceSettings'),
      'Expected workspace settings attempt'
    );
    assert.ok(
      executedCommands.some((c) => c.command === 'workbench.action.openSettings'),
      'Expected fallback to user settings'
    );
  });
});
