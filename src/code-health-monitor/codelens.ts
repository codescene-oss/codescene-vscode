import * as vscode from 'vscode';
import { onDidChangeConfiguration, reviewCodeLensesEnabled } from '../configuration';
import { issueToDocsParams } from '../documentation/csdoc-provider';
import { reviewDocumentSelector } from '../language-support';
import { DeltaFunctionInfo } from './tree-model';

export function register(context: vscode.ExtensionContext) {
  const codeLensProvider = new CodeHealthMonitorCodeLens();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(reviewDocumentSelector(), codeLensProvider),
    vscode.commands.registerCommand('codescene.monitorCodeLens.showFunction', (functionInfo: DeltaFunctionInfo) => {
      const uri = functionInfo.parent.uri;
      const pos = functionInfo.range.start;
      const location = new vscode.Location(uri, pos);
      codeLensProvider.showFor(functionInfo);
      void vscode.commands.executeCommand('editor.action.goToLocations', uri, pos, [location]);
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
      onDidChangeConfiguration('enableReviewCodeLenses', () => this.showFor(functionInfo)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri !== documentUri) return;
        this.dismiss();
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri !== documentUri) return;
        this.dismiss();
      }),
    ];

    const refactorCodeLenses = this.refactorCodeLenses(functionInfo);
    const issueCodeLenses: vscode.CodeLens[] = [];
    if (!reviewCodeLensesEnabled()) {
      let order = 1;
      functionInfo.children.forEach((issue) => {
        const range = this.lensRange(issue.position, order++);
        issueCodeLenses.push(
          new vscode.CodeLens(range, {
            title: `$(warning) ${issue.changeDetail.category}`,
            command: 'codescene.openInteractiveDocsPanel',
            arguments: [issueToDocsParams(issue, functionInfo.refactoring)],
          })
        );
      });
      if (refactorCodeLenses.length === 2) {
        refactorCodeLenses[1].range = this.lensRange(refactorCodeLenses[1].range.start, order++);
      }
    }

    this.codeLenses = refactorCodeLenses ? [...refactorCodeLenses, ...issueCodeLenses] : issueCodeLenses;
    this.update();
  }

  /**
   * The order of the code lenses on the same line (and from the same provider) is decided by the start character in
   * the range
   * */
  private lensRange(pos: vscode.Position, character: number) {
    return new vscode.Range(pos.with({ character }), pos.with({ character }));
  }

  private refactorCodeLenses(functionInfo: DeltaFunctionInfo): [vscode.CodeLens, vscode.CodeLens] | [] {
    if (!functionInfo.refactoring) return [];

    const startOfLine = functionInfo.range.start.with({ character: 0 });
    return [
      new vscode.CodeLens(new vscode.Range(startOfLine, startOfLine), {
        title: '$(sparkle) CodeScene ACE',
        command: 'codescene.presentRefactoring',
        arguments: [functionInfo.refactoring],
      }),
      new vscode.CodeLens(new vscode.Range(startOfLine.with({ character: 1 }), startOfLine.with({ character: 1 })), {
        title: '$(circle-slash) Dismiss',
        command: 'codescene.monitorCodeLens.dismiss',
      }),
    ];
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
