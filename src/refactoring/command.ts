import vscode, { DocumentSymbol, SymbolKind, TextDocument, Uri, commands, window } from 'vscode';
import { RefactoringPanel } from './refactoring-panel';
import { CsRestApi } from '../cs-rest-api';

export const name = 'codescene.requestRefactoring';

export class CsRefactoringCommand {
  private readonly csRestApi: CsRestApi;
  constructor(csRestApi: CsRestApi) {
    this.csRestApi = csRestApi;
  }

  async requestRefactoring(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    diagnostics: vscode.Diagnostic[]
  ) {
    // find function in functions matching the one in the diagnostics[0] range
    const requestData = await this.refactorRequest(document, diagnostics[0]);

    if (!requestData) {
      console.error('Could not get refactor request data');
      return;
    }

    RefactoringPanel.createOrShow(context.extensionUri, document, requestData);
    this.csRestApi
      .fetchRefactoring(requestData, 'trace-id')
      .then((refactorResponse) => {
        console.log('Received refactoring response: ' + JSON.stringify(refactorResponse));
        RefactoringPanel.createOrShow(context.extensionUri, document, requestData, refactorResponse);
      })
      .catch((err) => {
        console.log('Error in refactor request!', JSON.stringify(requestData), err);
      });
  }

  private async functionsInDoc(document: TextDocument) {
    const symbolsToFind = [SymbolKind.Function, SymbolKind.Method];

    const docSymbols = (await commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      document.uri
    )) as DocumentSymbol[];

    const docSymbolsFunctionsMethods = docSymbols
      ? docSymbols.filter((symbol) => symbolsToFind.includes(symbol.kind))
      : undefined;

    return Promise.resolve(docSymbolsFunctionsMethods);
  }

  private codeToCategory(diagnosticCode: string | number | { value: string | number; target: Uri } | undefined) {
    if (typeof diagnosticCode === 'object') {
      return diagnosticCode.value.toString();
    }
    return 'unknown category';
  }

  private async refactorRequest(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): Promise<RefactorRequest | undefined> {
    const functions = await this.functionsInDoc(document);
    const fn = functions?.find((f) => f.range.intersection(diagnostic.range));
    if (!fn) return undefined;

    const review: Review = {
      category: this.codeToCategory(diagnostic.code),
      start_line: diagnostic.range.start.line,
    };

    const sourceSnippet: SourceSnippet = {
      language: 'JavaScript',
      start_line: fn.range.start.line,
      end_line: fn.range.end.line + 1, // +1 because we want the linebreak at the end
      content: document.getText(fn.range),
    };
    return { review: [review], source_snippet: sourceSnippet };
  }
}
