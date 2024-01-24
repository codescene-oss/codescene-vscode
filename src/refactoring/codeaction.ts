import * as vscode from 'vscode';
import { awaitAndShowRefactoringCmdName, requestAndShowRefactoringCmdName } from './command';

export class CsRefactorCodeAction implements vscode.CodeActionProvider {
  private supportedCodeSmells: string[];

  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorRewrite];

  public constructor(supportedCodeSmells: string[]) {
    this.supportedCodeSmells = supportedCodeSmells;
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const supportedCsDiagnostics = context.diagnostics
      .filter((d: vscode.Diagnostic) => d.source === 'CodeScene')
      .filter((d: vscode.Diagnostic) => {
        if (typeof d.code === 'object') {
          return this.supportedCodeSmells.includes(d.code.value.toString());
        }
        return false;
      });

    if (supportedCsDiagnostics.length <= 0) return;

    // TODO - get the RefactoringRequest from our map, and if it's done we could show different types of code actions!

    const syncRefactorCommand = {
      command: requestAndShowRefactoringCmdName,
      title: 'CodeScene Refactor', // Unclear where this is shown in the UI
      tooltip: 'Refactor this code using the CodeScene AI Refactoring service',
      arguments: [document, range, supportedCsDiagnostics],
    };

    const synchronizedRefactorAction = new vscode.CodeAction(
      'CodeScene Refactor',
      vscode.CodeActionKind.RefactorRewrite
    );
    synchronizedRefactorAction.command = syncRefactorCommand;

    const refacAction = new vscode.CodeAction('CodeScene Prefactor', vscode.CodeActionKind.RefactorRewrite);
    refacAction.command = {
      command: awaitAndShowRefactoringCmdName,
      title: 'CodeScene Prefactor',
      tooltip: 'Refactor this code using the CodeScene AI Refactoring service',
      arguments: [document, supportedCsDiagnostics],
    };

    return [synchronizedRefactorAction, refacAction];
  }
}
