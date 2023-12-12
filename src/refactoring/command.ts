import vscode, { DocumentSymbol, SymbolKind, TextDocument, Uri, commands, window } from 'vscode';
import axios, { AxiosRequestConfig } from 'axios';

export const name = 'codescene.requestRefactoring';
const endpoint = 'http://localhost:3005/api/refactor';

function tokenAuth(): string {
  const accessToken = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiamwifQ.zX8NKY4WQfD2jg8NNP03ObdUK_jraWabdOlsXkfM-JA';
  return 'Token ' + accessToken;
}

async function findFunctions(document: TextDocument) {
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
    const valueObj = JSON.parse(diagnosticCode.value.toString());
    return valueObj.category;
  }
  return 'unknown category';
}

async function refactorRequest(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic
): Promise<RefactorRequest | undefined> {
  const functions = await findFunctions(document);
  const fn = functions?.find((f) => f.range.intersection(diagnostic.range));
  if (!fn) return undefined;

  const review: Review = {
    category: codeToCategory(diagnostic.code),
    start_line: diagnostic.range.start.line,
  };

  const sourceSnippet: SourceSnippet = {
    language: 'JavaScript',
    start_line: fn.range.start.line,
    content: document.getText(fn.range),
  };
  return { review: [review], source_snippet: sourceSnippet };
}

export async function requestRefactoring(
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
    },
    timeout: 15000,
  };

  console.log(`POST ${endpoint}: ${JSON.stringify(requestData)}`);
  // return;

  axios
    .post(endpoint, requestData, config)
    .then((response) => {
      const refactoring: RefactorResponse = response.data;
      console.log('Received refactoring response: ' + JSON.stringify(refactoring));
    })
    .catch((err) => {
      console.log('Error in refactor request');
    });
}
