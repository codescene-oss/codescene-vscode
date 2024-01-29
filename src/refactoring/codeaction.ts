import vscode, { CodeActionKind } from 'vscode';
import { RefactorResponse } from '../cs-rest-api';
import { isDefined } from '../utils';
import { FnToRefactor, commandFromLevel, showRefactoringCmdName } from './command';
import CsRefactoringRequests from './cs-refactoring-requests';

export class CsRefactorCodeAction implements vscode.CodeActionProvider {
  private supportedCodeSmells: string[];

  public static readonly providedCodeActionKinds = [
    CodeActionKind.QuickFix,
    CodeActionKind.RefactorRewrite,
    CodeActionKind.Empty,
  ];

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
      .filter((d: vscode.Diagnostic) => {
        if (typeof d.code === 'object') {
          return this.supportedCodeSmells.includes(d.code.value.toString());
        }
        return false;
      });

    if (supportedCsDiagnostics.length <= 0) return;

    const codeActions = supportedCsDiagnostics
      .map((diagnostic) => {
        const refacRequest = CsRefactoringRequests.get(diagnostic);
        if (!refacRequest?.resolvedResponse) {
          return;
        }
        const response = refacRequest.resolvedResponse;
        const fnToRefactor = refacRequest.fnToRefactor;
        return toCodeAction(document, response, diagnostic, fnToRefactor);
      })
      .filter(isDefined);

    return codeActions;
  }
}

function toCodeAction(
  document: vscode.TextDocument,
  response: RefactorResponse,
  diagnostic: vscode.Diagnostic,
  fnToRefactor: FnToRefactor
) {
  const {
    confidence: { level },
  } = response;

/*   const diagCodeToString = (code: string | number | { value: string | number; target: vscode.Uri } | undefined) => {
    if (typeof code === 'object') {
      return code.value.toString();
    }
    return code?.toString() || 'unknown issue';
  };
  const issue = diagCodeToString(diagnostic.code); */

  let codeActionKind;
  let command = commandFromLevel(level, {document, fnToRefactor, refactorResponse: response});

  switch (level) {
    case 3:
      // `🧑‍🚀 Refactoring recommendation for ${issue} in '${fnToRefactor.name}'`;
      codeActionKind = CodeActionKind.QuickFix;
      break;
    case 2:
      codeActionKind = CodeActionKind.RefactorRewrite;
      break;
    case 1:
      codeActionKind = CodeActionKind.Empty;
      break;
    default:
      // No code action!
      return;
  }

  const codeAction = new vscode.CodeAction(command.title, codeActionKind);
  codeAction.command = command;
  return codeAction;
}
