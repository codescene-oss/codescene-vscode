import vscode, { DocumentSymbol, SymbolKind, TextDocument, Uri, commands, window } from 'vscode';
import { RefactoringPanel } from './refactoring-panel';
import { CsRestApi } from '../cs-rest-api';
import { AxiosError } from 'axios';

export const name = 'codescene.requestRefactoring';

export class CsRefactoringCommand {
  private readonly csRestApi: CsRestApi;
  constructor(csRestApi: CsRestApi) {
    this.csRestApi = csRestApi;
  }

  /**
   *
   * @param context
   * @param document The document the user has invoked the refactoring on
   * @param refactorInitializationRange Where in the source code the user has invoked the refactoring
   * @param diagnostics List of valid CodeScene diagnostics. length guaranteed > 0. See refactor/codeaction.ts
   * for details on how the diagnostics are filtered.
   * @returns
   */
  async requestRefactoring(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    refactorInitializationRange: vscode.Range | vscode.Selection,
    diagnostics: vscode.Diagnostic[]
  ) {
    const diagnostic = diagnostics[0];
    const fn = await findFunctionToRefactor(document, diagnostic.range);
    if (!fn) {
      console.error('Could not find a suitable function to refactor.');
      window.showErrorMessage('Could not find a suitable function to refactor.');
      return;
    }
    const requestData = await refactorRequest(document, diagnostic, fn);

    RefactoringPanel.createOrShow(context.extensionUri, document, requestData);
    this.csRestApi
      .fetchRefactoring(requestData, 'trace-id')
      .then((refactorResponse) => {
        console.log('Received refactoring response: ' + JSON.stringify(refactorResponse));
        RefactoringPanel.createOrShow(context.extensionUri, document, requestData, refactorResponse);
      })
      .catch((err: Error | AxiosError) => {
        console.log('Error in refactor request!', JSON.stringify(requestData), err);
        RefactoringPanel.createOrShow(context.extensionUri, document, requestData, err.message);
      });
  }
}

async function refactorRequest(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  fn: DocumentSymbol
): Promise<RefactorRequest> {
  const review: Review = {
    category: codeToCategory(diagnostic.code),
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

function codeToCategory(diagnosticCode: string | number | { value: string | number; target: Uri } | undefined) {
  if (typeof diagnosticCode === 'object') {
    return diagnosticCode.value.toString();
  }
  return 'unknown category';
}

const symbolsToFind = [SymbolKind.Function, SymbolKind.Method];
const symbolFilter = (symbol: DocumentSymbol) => symbolsToFind.includes(symbol.kind);

function getFilteredSymbols(symbols: DocumentSymbol[]) {
  const filteredSymbols = symbols.filter(symbolFilter);
  const childSymbols = symbols.flatMap((s) => getFilteredSymbols(s.children));
  filteredSymbols.push(...childSymbols);
  return filteredSymbols;
}

async function findFunctionToRefactor(document: TextDocument, range: vscode.Range) {
  const docSymbols = (await commands.executeCommand(
    'vscode.executeDocumentSymbolProvider',
    document.uri
  )) as DocumentSymbol[];

  const allFunctionsAndMethods = getFilteredSymbols(docSymbols);
  const potentialFunctions = allFunctionsAndMethods.filter((s) => s.range.intersection(range));
  const smallestRangeFunction = potentialFunctions.reduce((prev, curr) => {
    const prevRange = prev.range.end.line - prev.range.start.line;
    const currRange = curr.range.end.line - curr.range.start.line;
    return currRange < prevRange ? curr : prev;
  });

  return Promise.resolve(smallestRangeFunction);
}
