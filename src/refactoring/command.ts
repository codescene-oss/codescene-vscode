import vscode, { DocumentSymbol, SymbolKind, TextDocument, Uri, commands, window } from 'vscode';
import axios, { AxiosRequestConfig } from 'axios';
import { getServerApiUrl } from '../configuration';
import { RefactoringPanel } from './refactoring-panel';

export const name = 'codescene.requestRefactoring';

function tokenAuth(): string {
  const accessToken =
    'MQ-MjAyNC0xMi0xMlQxMzowNjoyMw-I3sicmVmYWN0b3IuYWNjZXNzIiAiY2xpLmFjY2VzcyJ9.BY7cfqzAHYBMRAR-h9saBiSUvfgRCpBK0R69lNVOl6A';
  return 'Bearer ' + accessToken;
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
  if (typeof diagnosticCode === 'object') {
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

  const refactorUrl = `${getServerApiUrl()}/v2/refactor/`;
  console.log(`Requesting a refactoring from ${refactorUrl}`);

  RefactoringPanel.createOrShow(context.extensionUri, document, requestData);
  axios
    .post(refactorUrl, requestData, config)
    .then((response) => {
      const refactorResponse: RefactorResponse = response.data;
      console.log('Received refactoring response: ' + JSON.stringify(refactorResponse));
      RefactoringPanel.createOrShow(context.extensionUri, document, requestData, refactorResponse);
    })
    .catch((err) => {
      console.log('Error in refactor request!', JSON.stringify(requestData), err);
    });
}

// TODO both this API call and the one above should be moved out to cs-rest-api.ts when we are ready
// for that
export async function refactorPreFlight() {
  const preflightUrl = `${getServerApiUrl()}/v2/refactor/preflight`;

  console.log(`Requesting preflight data from ${preflightUrl}`);
  // copying this stuff, can fix later
  const config: AxiosRequestConfig = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: tokenAuth(),
      'x-codescene-trace-id': 'trace-id',
    },
    timeout: 15000,
  };
  return axios
    .get(preflightUrl, config)
    .then((response) => {
      return response.data as PreFlightResponse;
    })
    .catch((err) => {
      console.error('Error when making preflight request, ', err);
    });
}
