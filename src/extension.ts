import * as vscode from 'vscode';
import debounce = require('lodash.debounce');
import { CsCodeLensProvider } from './codelens';
import { check } from './codescene-interop';

export function activate(context: vscode.ExtensionContext) {
  console.log('The CodeScene extension is now active!');

  // Diagnostics provides the squigglies and also form the basis for the CodeLenses.
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('codescene');
  context.subscriptions.push(diagnosticCollection);

  // Add CodeLens support
  const codeLensDocSelector = {
    language: 'clojure',
    scheme: 'file',
  };

  const codeLensProvider = new CsCodeLensProvider(diagnosticCollection);
  const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(codeLensDocSelector, codeLensProvider);
  context.subscriptions.push(codeLensProviderDisposable);

  // Diagnostics will be updated when a file is opened or when it is changed.
  // When that happens, we also want to update the CodeLenses.
  const runAndUpdateCodeLenses = (document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) => {
    // Only run on Clojure files (find a better way to do this)
    if (document.languageId !== 'clojure') {
      return;
    }
    check(document, diagnosticCollection).then(() => {
      codeLensProvider.update();
    });
  };

  // This provides the initial diagnostics and CodeLenses when a file is opened.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      runAndUpdateCodeLenses(document, diagnosticCollection);
    })
  );

  // For live updates, we debounce the runs to avoid consuming too many resources.
  const debouncedRun = debounce(runAndUpdateCodeLenses, 1000);
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(({ document }) => debouncedRun(document, diagnosticCollection))
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
