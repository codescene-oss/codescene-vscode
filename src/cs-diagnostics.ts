import * as vscode from 'vscode';
import { requestRefactoringCmdName } from './refactoring/command';
import CsRefactoringRequests, { CsRefactoringRequest } from './refactoring/cs-refactoring-requests';
import Reviewer, { ReviewOpts } from './review/reviewer';
import { isDefined } from './utils';

export const csSource = 'CodeScene';
export const csRefactorableSource = 'CodeScene AutoRefactor';

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
  private supportedCodeSmells: string[] | undefined;

  constructor(private supportedLanguages: string[]) {}

  setSupportedCodeSmells(supportedCodeSmells?: string[]) {
    this.supportedCodeSmells = supportedCodeSmells;
  }

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
    if (!isDefined(this.supportedCodeSmells)) return;

    const refactorableDiagnostics = diagnostics.filter(
      (d) => d.code instanceof Object && this.supportedCodeSmells?.includes(d.code.value.toString())
    );
    refactorableDiagnostics.forEach(async (d) => {
      // Return object with some diagnostic key and the promise?
      const cmdResult = await vscode.commands.executeCommand<CsRefactoringRequest | undefined>(
        requestRefactoringCmdName,
        document,
        d
      );
      CsRefactoringRequests.add(d, cmdResult);
    });
  }
}
