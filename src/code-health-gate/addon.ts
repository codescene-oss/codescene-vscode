import vscode from 'vscode';
import { AceAPI } from '../refactoring/addon';
import { registerCommandWithTelemetry } from '../utils';
import { CodeHealthGateView } from './tree-view';

export function activate(context: vscode.ExtensionContext, aceApi?: AceAPI) {
  const codeHealthGateView = new CodeHealthGateView(context, aceApi);

  context.subscriptions.push(
    codeHealthGateView,
    registerCommandWithTelemetry({
      commandId: 'codescene.codeHealthGateHelp',
      handler: () => {
        void vscode.commands.executeCommand(
          'markdown.showPreviewToSide',
          vscode.Uri.parse(`csdoc:code-health-gate.md`)
        );
      },
    })
  );
}
