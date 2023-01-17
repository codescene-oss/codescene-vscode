import * as vscode from 'vscode';
import debounce = require('lodash.debounce');
import { CsCodeLensProvider } from './codelens';
import { check } from './codescene-interop';

function getSupportedLanguages(extension: vscode.Extension<any>): string[] {
  return extension.packageJSON.activationEvents
    .filter((event: string) => event.startsWith('onLanguage:'))
    .map((event: string) => event.substring(11));
}

function getSupportedDocumentSelector(supportedLanguages: string[]) {
  return supportedLanguages.map((language) => ({ language, scheme: 'file' }));
}

export function activate(context: vscode.ExtensionContext) {
  console.log('CodeScene: the extension is now active!');

  const supportedLanguages = getSupportedLanguages(context.extension);

  // Diagnostics provides the squigglies and also form the basis for the CodeLenses.
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('codescene');
  context.subscriptions.push(diagnosticCollection);

  // Add CodeLens support
  const codeLensDocSelector = getSupportedDocumentSelector(supportedLanguages);

  const codeLensProvider = new CsCodeLensProvider();
  const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(codeLensDocSelector, codeLensProvider);
  context.subscriptions.push(codeLensProviderDisposable);

  // Diagnostics will be updated when a file is opened or when it is changed.
  const run = (document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, skipCache = false) => {
    if (document.uri.scheme !== 'file' || !supportedLanguages.includes(document.languageId)) {
      return;
    }
    check(document, skipCache).then((diagnostics) => {
      // Remove the first diagnostic, which is an info level message about the overall code health.
      diagnosticCollection.set(document.uri, diagnostics.slice(1));
    });
  };

  // This provides the initial diagnostics when a file is opened.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
      run(document, diagnosticCollection);
    })
  );

  // For live updates, we debounce the runs to avoid consuming too many resources.
  const debouncedRun = debounce(run, 2000);
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) =>
      debouncedRun(e.document, diagnosticCollection)
    )
  );

  // This provides the initial diagnostics when the extension is first activated.
  vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
    run(document, diagnosticCollection);
  });

  // Use a file system watcher to rerun diagnostics when .codescene/code-health-rules.json changes.
  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/.codescene/code-health-rules.json');
  fileSystemWatcher.onDidChange((uri: vscode.Uri) => {
    console.log('CodeScene: code-health-rules.json changed, updating diagnostics');
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      run(document, diagnosticCollection, true);
    });
    codeLensProvider.update();
  });
  context.subscriptions.push(fileSystemWatcher);
}

// This method is called when your extension is deactivated
export function deactivate() {}
