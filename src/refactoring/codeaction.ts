import * as vscode from 'vscode';
import { name as refactoringCommandName } from './command';

export class CsRefactorCodeAction implements vscode.CodeActionProvider {
  private readonly context: vscode.ExtensionContext;
  private supportedCodeSmells: string[];

  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  public constructor(context: vscode.ExtensionContext, supportedCodeSmells: string[]) {
    this.context = context;
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

    const command = {
      command: refactoringCommandName,
      title: 'refactor', // Unclear where this is shown in the UI
      tooltip: 'Refactor this code using the CodeScene AI Refactoring service',
      arguments: [this.context, document, range, supportedCsDiagnostics],
    };

    const quickFixAction = new vscode.CodeAction('CodeScene AI Refactor', vscode.CodeActionKind.QuickFix);
    quickFixAction.command = command;
    return [quickFixAction];
  }
}
