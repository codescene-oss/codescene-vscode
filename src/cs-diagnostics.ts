import * as vscode from 'vscode';
import Reviewer, { ReviewOpts } from './review/reviewer';

export default class CsDiagnosticsCollection {
  private static _instance: vscode.DiagnosticCollection;

  static init(context: vscode.ExtensionContext) {
    if (!CsDiagnosticsCollection._instance) {
      CsDiagnosticsCollection._instance = vscode.languages.createDiagnosticCollection('codescene');
      context.subscriptions.push(CsDiagnosticsCollection._instance);
    }
  }
  static get instance(): vscode.DiagnosticCollection {
    return CsDiagnosticsCollection._instance;
  }
}

/**
 * Reviews a supported document using the Reviewer instance and updates the CodeScene diagnostic collection.
 */
export class CsDiagnostics {
  constructor(private supportedLanguages: string[]) {}

  review(document: vscode.TextDocument, reviewOpts?: ReviewOpts) {
    // Diagnostics will be updated when a file is opened or when it is changed.
    if (document.uri.scheme !== 'file' || !this.supportedLanguages.includes(document.languageId)) {
      return;
    }
    Reviewer.instance.review(document, reviewOpts).then((diagnostics) => {
      // Remove the diagnostics that are for file level issues. These are only shown as code lenses
      const importantDiagnostics = diagnostics.filter((d) => !d.range.isEmpty);
      CsDiagnosticsCollection.instance.set(document.uri, importantDiagnostics);
    });
  }
}
