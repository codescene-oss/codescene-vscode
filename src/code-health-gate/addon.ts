import vscode from 'vscode';
import { registerDeltaAnalysisDecorations } from './presentation';
import { CodeHealthGateView } from './tree-view';

export default function initializeCodeHealthGate(context: vscode.ExtensionContext) {
  context.subscriptions.push(new CodeHealthGateView());
  registerDeltaAnalysisDecorations(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.codeHealthGateHelp', () => {
      void vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.parse(`csdoc:code-health-gate.md`));
    })
  );
}
