import vscode from 'vscode';
import { AceAPI } from '../refactoring/addon';
import { registerDeltaAnalysisDecorations } from './presentation';
import { CodeHealthGateView } from './tree-view';

export function activate(context: vscode.ExtensionContext, aceApi?: AceAPI) {
  context.subscriptions.push(new CodeHealthGateView(aceApi));
  registerDeltaAnalysisDecorations(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.codeHealthGateHelp', () => {
      void vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.parse(`csdoc:code-health-gate.md`));
    })
  );
}
