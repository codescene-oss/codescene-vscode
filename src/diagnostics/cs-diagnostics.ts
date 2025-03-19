import * as vscode from 'vscode';
import { reviewDocumentSelector } from '../language-support';
import Reviewer, { ReviewOpts } from '../review/reviewer';
import { CodeSmell } from '../review/model';

export const csSource = 'CodeScene';

export class CsDiagnostic extends vscode.Diagnostic {
  constructor(
    range: vscode.Range,
    message: string,
    severity: vscode.DiagnosticSeverity,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private _codeSmell?: CodeSmell
  ) {
    let msg;
    if (_codeSmell) {
      msg = `${_codeSmell.category} (${_codeSmell.details})`;
    } else {
      msg = message;
    }
    super(range, msg, severity);
  }

  public get codeSmell() {
    return this._codeSmell;
  }
}

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

  static set(uri: vscode.Uri, diagnostics: CsDiagnostic[]) {
    CsDiagnostics.collection.set(uri, diagnostics);
  }

  static review(document: vscode.TextDocument, reviewOpts?: ReviewOpts) {
    if (vscode.languages.match(CsDiagnostics.documentSelector, document) === 0) {
      return;
    }

    void Reviewer.instance.review(document, reviewOpts).diagnostics.then((diagnostics) => {
      // Only include diagnostics with actual code smells in the problems view.
      const diagnosticsWithCodeSmells = diagnostics.filter((d) => d.codeSmell !== null);
      CsDiagnostics.set(document.uri, diagnosticsWithCodeSmells);
    });
  }
}
