import * as vscode from 'vscode';
import { onDidChangeConfiguration } from '../configuration';
import { issueToDocsParams } from '../documentation/csdoc-provider';
import { reviewDocumentSelector } from '../language-support';
import { DeltaFunctionInfo } from './tree-model';

export function register(context: vscode.ExtensionContext) {
  const codeLensProvider = new CodeHealthMonitorCodeLens();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(reviewDocumentSelector(), codeLensProvider),
    vscode.commands.registerCommand('codescene.monitorCodeLens.showFunction', (functionInfo: DeltaFunctionInfo) => {
      const uri = functionInfo.parent.uri;
      const location = new vscode.Location(uri, functionInfo.position);
      codeLensProvider.showFor(functionInfo);
      void vscode.commands.executeCommand('editor.action.goToLocations', uri, functionInfo.position, [location]);
    }),
    vscode.commands.registerCommand('codescene.monitorCodeLens.dismiss', () => {
      codeLensProvider.dismiss();
    })
  );
}

export class CodeHealthMonitorCodeLens implements vscode.CodeLensProvider<vscode.CodeLens> {
  private changeCodeLensesEmitter = new vscode.EventEmitter<void>();
  onDidChangeCodeLenses = this.changeCodeLensesEmitter.event;

  codeLenses: vscode.CodeLens[] = [];

  // Listeners to dismiss the menu code lenses when the document is changed or closed
  private disposables: vscode.Disposable[] = [];

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    return this.codeLenses;
  }

  update() {
    this.changeCodeLensesEmitter.fire();
  }

  showFor(functionInfo: DeltaFunctionInfo) {
    this.clear();
    const documentUri = functionInfo.parent.uri;
    this.disposables = [
      onDidChangeConfiguration('previewCodeHealthMonitoring', () => this.dismiss()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri !== documentUri) return;
        this.dismiss();
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri !== documentUri) return;
        this.dismiss();
      }),
    ];

    const fnRange = new vscode.Range(functionInfo.position, functionInfo.position);
    if (functionInfo.refactoring) {
      this.codeLenses.push(
        new vscode.CodeLens(fnRange, {
          title: '$(sparkle) CodeScene ACE',
          command: 'codescene.presentRefactoring',
          arguments: [functionInfo.refactoring],
        })
      );
    }

    functionInfo.children.forEach((issue) => {
      const issueRange = new vscode.Range(issue.position, issue.position);
      this.codeLenses.push(
        new vscode.CodeLens(issueRange, {
          title: `$(warning) ${issue.category}`,
          command: 'codescene.openInteractiveDocsPanel',
          arguments: [issueToDocsParams(issue, functionInfo.refactoring)],
        })
      );
    });

    this.codeLenses.push(
      new vscode.CodeLens(fnRange, {
        title: '$(circle-slash) Dismiss',
        command: 'codescene.monitorCodeLens.dismiss',
        arguments: [documentUri],
      })
    );

    this.update();
  }

  private clear() {
    this.disposables.forEach((l) => l.dispose());
    this.codeLenses = [];
  }

  dismiss() {
    this.clear();
    this.update();
  }
}
