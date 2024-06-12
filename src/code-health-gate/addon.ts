import vscode from 'vscode';
import { reviewDocumentSelector } from '../language-support';
import { AceAPI } from '../refactoring/addon';
import { DeltaAnalyser } from './analyser';
import { CodeHealthGateView } from './tree-view';
import { registerCommandWithTelemetry } from '../utils';

export function activate(context: vscode.ExtensionContext, aceApi?: AceAPI) {
  const codeHealthGateView = new CodeHealthGateView(context, aceApi);
  const documentSelector = reviewDocumentSelector();

  context.subscriptions.push(
    codeHealthGateView,
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (vscode.languages.match(documentSelector, document) === 0 || !codeHealthGateView.isVisible()) return;
      DeltaAnalyser.analyseWorkspace();
    }),
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
