import vscode from 'vscode';
import { AceAPI } from '../refactoring/addon';
import { registerCommandWithTelemetry } from '../utils';
import { CodeHealthMonitorView } from './tree-view';

export function activate(context: vscode.ExtensionContext, aceApi?: AceAPI) {
  const codeHealthMonitorView = new CodeHealthMonitorView(context, aceApi);

  context.subscriptions.push(
    codeHealthMonitorView,
    registerCommandWithTelemetry({
      commandId: 'codescene.codeHealthMonitorHelp',
      handler: () => {
        void vscode.commands.executeCommand(
          'markdown.showPreviewToSide',
          vscode.Uri.parse(`csdoc:code-health-monitor.md`)
        );
      },
    })
  );
}
