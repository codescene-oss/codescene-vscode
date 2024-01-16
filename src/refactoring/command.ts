import vscode, { DocumentSymbol, SymbolKind, TextDocument, Uri, commands, window } from 'vscode';
import { RefactoringPanel } from './refactoring-panel';
import { CsRestApi } from '../cs-rest-api';
import axios, { AxiosError } from 'axios';

export const name = 'codescene.requestRefactoring';

export class CsRefactoringCommand {
  private readonly csRestApi: CsRestApi;
  private abortController: AbortController | undefined;

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
      console.error('CodeScene: Could not find a suitable function to refactor.');
      window.showErrorMessage('Could not find a suitable function to refactor.');
      return;
    }

    const editor = window.activeTextEditor;
    if (editor) {
      editor.selection = new vscode.Selection(fn.range.start, fn.range.end);
      editor.revealRange(fn.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    const extensionUri = context.extensionUri;
    const request = refactorRequest(document, diagnostic, fn);
    const initiatorViewColumn = editor?.viewColumn;

    // Send abort signal to currently running refactoring request (if any)
    if (this.abortController) this.abortController.abort();

    this.abortController = new AbortController(); // New abort controller for the new request
    console.log(`CodeScene: Requesting refactoring suggestion for "${fn.name}" from CodeScene's AI service`);
    RefactoringPanel.createOrShow({ extensionUri, document, initiatorViewColumn, fnToRefactor: fn });
    this.csRestApi
      .fetchRefactoring(request, this.abortController.signal)
      .then((response) => {
        RefactoringPanel.createOrShow({ extensionUri, document, initiatorViewColumn, fnToRefactor: fn, response });
      })
      .catch((err: Error | AxiosError) => {
        if (err instanceof AxiosError && axios.isCancel(err)) {
          console.log('CodeScene: Previous refactor request cancelled.');
          return;
        }

        RefactoringPanel.createOrShow({
          extensionUri,
          document,
          initiatorViewColumn,
          fnToRefactor: fn,
          response: err.message,
        });
      });
  }
}

function refactorRequest(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  fn: DocumentSymbol
): RefactorRequest {
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
  const docSymbols = (await commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri)) as
    | DocumentSymbol[]
    | undefined;

  if (!docSymbols) return;

  const allFunctionsAndMethods = getFilteredSymbols(docSymbols);
  const potentialFunctions = allFunctionsAndMethods.filter((s) => s.range.intersection(range));
  const smallestRangeFunction = potentialFunctions.reduce((prev, curr) => {
    const prevRange = prev.range.end.line - prev.range.start.line;
    const currRange = curr.range.end.line - curr.range.start.line;
    return currRange < prevRange ? curr : prev;
  });

  return Promise.resolve(smallestRangeFunction);
}
