import * as vscode from 'vscode';
import { CodeSmell } from '../devtools-api/review-model';

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
