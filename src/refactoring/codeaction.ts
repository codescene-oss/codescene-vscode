import * as vscode from 'vscode';
import { name as refactoringCommandName } from './command';

export class CsRefactorCodeAction implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.Refactor,
    // vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const csDiagnostics = context.diagnostics.filter((d: any) => d.source === 'CodeScene');
    // Filter out complex-conditionals only?
    if (csDiagnostics.length <= 0) return;

    const refactorAction = new vscode.CodeAction('CodeScene AI Refactor', vscode.CodeActionKind.Refactor);
    refactorAction.command = {
      command: refactoringCommandName,
      title: 'Request AI Refactoring',
      arguments: [document, range, csDiagnostics],
    };
    // const quickFixAction = new vscode.CodeAction('CodeScene AI Refactor', vscode.CodeActionKind.QuickFix);
    // quickFixAction.command = { command: refactoringCommandName, title: 'Request AI Refactoring' };
    return [refactorAction /*, quickFixAction*/];
  }

}
