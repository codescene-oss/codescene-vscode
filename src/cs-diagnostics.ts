import * as vscode from 'vscode';
import { requestRefactoringsCmdName } from './refactoring/commands';
import Reviewer, { ReviewOpts, chScorePrefix } from './review/reviewer';
import { reviewDocumentSelector } from './language-support';
import { logOutputChannel } from './log';

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
  private readonly documentSelector: vscode.DocumentSelector;

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

        // Try to request refactorings for the important diagnostics
        void vscode.commands.executeCommand(requestRefactoringsCmdName, document, importantDiagnostics);
      })
      .catch((e) => {
        logOutputChannel.error(`Review error ${e}`);
      });
  }
}
