import vscode, { DocumentSymbol, SymbolKind, TextDocument, Uri, commands, window } from 'vscode';
import axios, { AxiosRequestConfig } from 'axios';
import { getRefactoringServerBaseUrl } from '../configuration';
import { RefactoringPanel } from './refactoring-panel';

export const name = 'codescene.requestRefactoring';

function tokenAuth(): string {
  const accessToken = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiamwifQ.oH372TqYmz7Cm3SB5A-sn3AlpFXy1G3EaNBDVE3jmc8';
  return 'Token ' + accessToken;
}

async function functionsInDoc(document: TextDocument) {
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

function codeToCategory(diagnosticCode: string | number | { value: string | number; target: Uri } | undefined) {
  if (diagnosticCode instanceof Object) {
    return diagnosticCode.value.toString();
  }
  return 'unknown category';
}

async function refactorRequest(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic
): Promise<RefactorRequest | undefined> {
  const functions = await functionsInDoc(document);
  const fn = functions?.find((f) => f.range.intersection(diagnostic.range));
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

export async function requestRefactoring(
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

  const config: AxiosRequestConfig = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: tokenAuth(),
      'x-codescene-trace-id': 'trace-id',
    },
    timeout: 15000,
  };

  const refactorUrl = `${getRefactoringServerBaseUrl()}/api/refactor`;
  console.log(`Requesting a refactoring from ${refactorUrl}`);

  axios
    .post(refactorUrl, requestData, config)
    .then((response) => {
      const refactoring: RefactorResponse = response.data;
      console.log('Received refactoring response: ' + JSON.stringify(refactoring));
      RefactoringPanel.createOrShow(context.extensionUri, document, requestData, refactoring);
    })
    .catch((err) => {
      console.log('Error in refactor request, ', err);
    });
}
