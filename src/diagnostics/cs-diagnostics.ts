import * as vscode from 'vscode';
import { reviewDocumentSelector } from '../language-support';
import Reviewer, { ReviewOpts } from '../review/reviewer';
import { isGeneralDiagnostic } from '../review/utils';

export const csSource = 'CodeScene';

export default class CsDiagnostics {
  // The collection of diagnostics presented in the Problems tab
  private static collection: vscode.DiagnosticCollection;
  private static readonly documentSelector: vscode.DocumentSelector = reviewDocumentSelector();

  static init(context: vscode.ExtensionContext) {
    if (!CsDiagnostics.collection) {
      CsDiagnostics.collection = vscode.languages.createDiagnosticCollection('codescene');
      context.subscriptions.push(CsDiagnostics.collection);
    }
  }

  static set(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) {
    CsDiagnostics.collection.set(uri, diagnostics);
  }

  static review(document: vscode.TextDocument, reviewOpts?: ReviewOpts) {
    if (vscode.languages.match(CsDiagnostics.documentSelector, document) === 0) {
      return;
    }

    void Reviewer.instance.review(document, reviewOpts).diagnostics.then((diagnostics) => {
      // Remove the diagnostic showing the code health score. It should only be shown as a codelens, not in the problems view.
      const importantDiagnostics = diagnostics.filter((d) => !isGeneralDiagnostic(d));
      CsDiagnostics.set(document.uri, importantDiagnostics);
    });
  }
}
