import * as vscode from 'vscode';
import { requestRefactoringsCmdName } from './refactoring/commands';
import Reviewer, { ReviewOpts, chScorePrefix } from './review/reviewer';
import { reviewDocumentSelector } from './language-support';

export const csSource = 'CodeScene';

export default class CsDiagnosticsCollection {
  private static _instance: vscode.DiagnosticCollection;

  static init(context: vscode.ExtensionContext) {
    if (!CsDiagnosticsCollection._instance) {
      CsDiagnosticsCollection._instance = vscode.languages.createDiagnosticCollection('codescene');
      context.subscriptions.push(CsDiagnosticsCollection._instance);
    }
  }

  static set(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) {
    CsDiagnosticsCollection._instance.set(uri, diagnostics);
  }
}

/**
 * Reviews a supported document using the Reviewer instance and updates the CodeScene diagnostic collection.
 */
export class CsDiagnostics {
  private documentSelector: vscode.DocumentSelector;

  constructor() {
    this.documentSelector = reviewDocumentSelector();
  }

  review(document: vscode.TextDocument, reviewOpts?: ReviewOpts) {
    if (vscode.languages.match(this.documentSelector, document) === 0) {
      return;
    }
    Reviewer.instance
      .review(document, reviewOpts)
      .then((diagnostics) => {
        // Remove the diagnostics that are for file level issues. These are only shown as code lenses
        const importantDiagnostics = diagnostics.filter((d) => !d.message.startsWith(chScorePrefix));
        CsDiagnosticsCollection.set(document.uri, importantDiagnostics);
        this.preInitiateRefactoringRequests(document, importantDiagnostics);
      })
      .catch((err) => {
        // Empty catch to avoid unhandled promise rejection when a previous review command is aborted by the executor
      });
  }

  private async preInitiateRefactoringRequests(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    vscode.commands.executeCommand(requestRefactoringsCmdName, document, diagnostics);
  }
}
