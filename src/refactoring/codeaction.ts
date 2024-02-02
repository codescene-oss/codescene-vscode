import vscode, { CodeActionKind } from 'vscode';
import { isDefined } from '../utils';
import { commandFromLevel } from './command';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';

export class CsRefactorCodeAction implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [CodeActionKind.QuickFix, CodeActionKind.Empty];

  public constructor(private codeSmellFilter: (d: vscode.Diagnostic) => boolean) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const uniqueRequests = new Set<CsRefactoringRequest>();

    context.diagnostics.filter(this.codeSmellFilter).forEach((diagnostic) => {
      const refacRequest = CsRefactoringRequests.get(document, diagnostic);
      if (!refacRequest?.resolvedResponse) return;
      uniqueRequests.add(refacRequest);
    });

    const codeActions: vscode.CodeAction[] = [];
    uniqueRequests.forEach((request) => {
      const action = toCodeAction(document, request);
      isDefined(action) && codeActions.push(action);
    });

    return codeActions;
  }
}

function toCodeAction(document: vscode.TextDocument, refactoringRequest: CsRefactoringRequest) {
  const { resolvedResponse, fnToRefactor } = refactoringRequest;
  if (!isDefined(resolvedResponse)) return;

  const {
    confidence: { level },
  } = resolvedResponse;

  let codeActionKind;
  let command = commandFromLevel(level, { document, fnToRefactor, refactorResponse: resolvedResponse });

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

  if (!isDefined(command) || !isDefined(codeActionKind)) return;

  const codeAction = new vscode.CodeAction(command.title, codeActionKind);
  codeAction.command = command;
  return codeAction;
}
