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

  async requestRefactoring(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    diagnostics: vscode.Diagnostic[]
  ) {
    // find function in functions matching the one in the diagnostics[0] range
    const requestData = await refactorRequest(document, diagnostics[0]);

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
      .catch((err: Error | AxiosError) => {
        console.log('Error in refactor request!', JSON.stringify(requestData), err);
        RefactoringPanel.createOrShow(context.extensionUri, document, requestData, err.message);
      });
  }
}

async function refactorRequest(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic
): Promise<RefactorRequest | undefined> {
  const fn = await findFunctionToRefactor(document, diagnostic.range);
  if (!fn) return undefined;

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
