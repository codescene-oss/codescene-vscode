import * as vscode from 'vscode';
import { requestRefactoringsCmdName } from './refactoring/command';
import Reviewer, { ReviewOpts } from './review/reviewer';

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
  constructor(private supportedLanguages: string[]) {}

  review(document: vscode.TextDocument, reviewOpts?: ReviewOpts) {
    // Diagnostics will be updated when a file is opened or when it is changed.
    if (document.uri.scheme !== 'file' || !this.supportedLanguages.includes(document.languageId)) {
      return;
    }
    Reviewer.instance
      .review(document, reviewOpts)
      .then((diagnostics) => {
        // Remove the diagnostics that are for file level issues. These are only shown as code lenses
        const importantDiagnostics = diagnostics.filter((d) => !d.range.isEmpty);
        CsDiagnosticsCollection.set(document.uri, importantDiagnostics);
        this.preInitiateRefactoringRequests(document, importantDiagnostics);
      })
      .catch((err) => {
        // Empty catch to avoid unhandled promise rejection when a previous review command is aborted by the executor
      });
  }

  private async preInitiateRefactoringRequests(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    vscode.commands.executeCommand(requestRefactoringsCmdName, document, diagnostics).then(
      () => {},
      (err) => {
        /**
         * Command might not be registered. It only exists when extension.enableRefactoringCommand() has been run.
         * If it doesn't exist we don't want to initiate any refactoring requests anyway, and if left unhandled
         * we get "rejected promise not handled"-errors.
         */
      }
    );
  }
}
