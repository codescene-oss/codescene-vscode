import vscode, { CodeActionKind } from 'vscode';
import { RefactorResponse } from '../cs-rest-api';
import { isDefined } from '../utils';
import { FnToRefactor, commandFromLevel } from './command';
import CsRefactoringRequests from './cs-refactoring-requests';

export class CsRefactorCodeAction implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    CodeActionKind.QuickFix,
    CodeActionKind.Empty,
  ];

  public constructor(private codeSmellFilter: (d: vscode.Diagnostic) => boolean) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const codeActions = context.diagnostics
      .filter(this.codeSmellFilter)
      .map((diagnostic) => {
        const refacRequest = CsRefactoringRequests.get(diagnostic);
        if (!refacRequest?.resolvedResponse) {
          return;
        }
        const response = refacRequest.resolvedResponse;
        const fnToRefactor = refacRequest.fnToRefactor;
        return toCodeAction(document, response, fnToRefactor);
      })
      .filter(isDefined);

    return codeActions;
  }
}

function toCodeAction(document: vscode.TextDocument, response: RefactorResponse, fnToRefactor: FnToRefactor) {
  const {
    confidence: { level },
  } = response;

  let codeActionKind;
  let command = commandFromLevel(level, { document, fnToRefactor, refactorResponse: response });

  switch (level) {
    case 3:
    case 2:
      codeActionKind = CodeActionKind.QuickFix;
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
