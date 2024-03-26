import vscode, { CodeActionKind } from 'vscode';
import { DiagnosticFilter, isDefined } from '../utils';
import { commandFromRequest, toConfidenceSymbol } from './commands';
import { CsRefactoringRequests, ResolvedRefactoring } from './cs-refactoring-requests';

export class CsRefactorCodeAction implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [CodeActionKind.QuickFix, CodeActionKind.Empty];

  public constructor(private codeSmellFilter: DiagnosticFilter) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const uniqueRefactorings = context.diagnostics
      .filter(this.codeSmellFilter)
      .map((diagnostic) => CsRefactoringRequests.get(document, diagnostic))
      .filter(isDefined)
      .map((request) => request.resolvedResponse())
      .filter(isDefined)
      .filter((r, i, rs) => rs.findIndex((rr) => rr.traceId === r.traceId) === i);

    const codeActions: vscode.CodeAction[] = [];
    uniqueRefactorings.forEach((refactoring) => {
      const action = toCodeAction(refactoring);
      isDefined(action) && codeActions.push(action);
    });

    return codeActions;
  }
}

function toCodeAction(refactoring: ResolvedRefactoring) {
  let codeActionKind;
  let command = commandFromRequest(refactoring);
  if (!isDefined(command)) return;

  const level = refactoring.response.confidence.level;
  const symbol = toConfidenceSymbol(level);
  if (level > 1) {
    codeActionKind = CodeActionKind.QuickFix;
  } else if (level === 1) {
    codeActionKind = CodeActionKind.Empty;
    // Override title, worded as an action instead of a noun
    command.title = `${symbol} View code improvement guide`;
  } else {
    return;
  }

  // Note that CodeActionKind.Empty does not appear in the problems context menu, only in the
  // light bulb/editor context menu under "More actions..."
  const codeAction = new vscode.CodeAction(command.title, codeActionKind);
  codeAction.command = command;
  return codeAction;
}
