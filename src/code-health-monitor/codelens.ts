import vscode, { Uri } from 'vscode';
import { onDidChangeConfiguration, reviewCodeLensesEnabled } from '../configuration';
import { issueToDocsParams } from '../documentation/commands';
import { reviewDocumentSelector } from '../language-support';
import { DeltaFunctionInfo } from './tree-model';

export function register(context: vscode.ExtensionContext) {
  const codeLensProvider = new CodeHealthMonitorCodeLens();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(reviewDocumentSelector(), codeLensProvider),
    vscode.commands.registerCommand('codescene.monitorCodeLens.showFunction', (functionInfo: DeltaFunctionInfo) => {
      const uri = functionInfo.parent.document.uri;
      const pos = functionInfo.range.start;
      const location = new vscode.Location(uri, pos);
      codeLensProvider.showFor(functionInfo);
      void vscode.commands.executeCommand('editor.action.goToLocations', uri, pos, [location]);
    }),
    vscode.commands.registerCommand('codescene.monitorCodeLens.dismiss', (documentUri: Uri) => {
      codeLensProvider.dismiss(documentUri);
    })
  );
}

export class CodeHealthMonitorCodeLens implements vscode.CodeLensProvider<vscode.CodeLens> {
  private changeCodeLensesEmitter = new vscode.EventEmitter<void>();
  onDidChangeCodeLenses = this.changeCodeLensesEmitter.event;

  private codeLensesMap: Map<Uri, vscode.CodeLens[]> = new Map<Uri, vscode.CodeLens[]>();

  // Listeners to dismiss the menu code lenses when the document is changed or closed
  private disposables: vscode.Disposable[] = [];

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    return this.codeLensesMap.get(document.uri);
  }

  update() {
    this.changeCodeLensesEmitter.fire();
  }

  showFor(functionInfo: DeltaFunctionInfo) {
    const documentUri = functionInfo.parent.document.uri;
    this.clear(documentUri);
    this.disposables = [
      onDidChangeConfiguration('enableReviewCodeLenses', () => this.showFor(functionInfo)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri !== documentUri) return;
        this.dismiss(documentUri);
      }),
    ];

    const codeLenses = [];
    const functionStartLine = functionInfo.range.start.with({ character: 0 });
    if (functionInfo.fnToRefactor) {
      codeLenses.push(
        new vscode.CodeLens(new vscode.Range(functionStartLine, functionStartLine), {
          title: '$(sparkle) CodeScene ACE',
          command: 'codescene.requestAndPresentRefactoring',
          arguments: [functionInfo.parent.document, functionInfo.fnToRefactor],
        })
      );
    }
    let order = 1;
    if (!reviewCodeLensesEnabled()) {
      functionInfo.children.forEach((issue) => {
        codeLenses.push(
          new vscode.CodeLens(this.lensRange(issue.position, order++), {
            title: `$(warning) ${issue.changeDetail.category}`,
            command: 'codescene.openInteractiveDocsPanel',
            arguments: [issueToDocsParams(issue, functionInfo)],
          })
        );
      });
    }
    codeLenses.push(
      new vscode.CodeLens(
        new vscode.Range(
          functionStartLine.with({ character: order++ }),
          functionStartLine.with({ character: order++ })
        ),
        {
          title: '$(circle-slash) Dismiss',
          command: 'codescene.monitorCodeLens.dismiss',
          arguments: [functionInfo.parent.document.uri],
        }
      )
    );

    this.codeLensesMap.set(documentUri, codeLenses);
    this.update();
  }

  /**
   * The order of the code lenses on the same line (and from the same provider) is decided by the start character in
   * the range
   * */
  private lensRange(pos: vscode.Position, character: number) {
    return new vscode.Range(pos.with({ character }), pos.with({ character }));
  }

  /**
   *
   * @param documentUri The document uri to clear the code lenses for. If not provided, all code lenses are cleared.
   */
  private clear(documentUri: Uri) {
    this.codeLensesMap.delete(documentUri);
    this.disposables.forEach((l) => l.dispose());
  }

  dismiss(documentUri: Uri) {
    this.clear(documentUri);
    this.update();
  }
}
