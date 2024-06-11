import vscode from 'vscode';
import { AceAPI } from '../refactoring/addon';
import { registerDeltaAnalysisDecorations } from './presentation';
import { CodeHealthGateView } from './tree-view';
import { registerCommandWithTelemetry } from '../utils';

export function activate(context: vscode.ExtensionContext, aceApi?: AceAPI) {
  context.subscriptions.push(new CodeHealthGateView(aceApi));
  registerDeltaAnalysisDecorations(context);

  context.subscriptions.push(
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
