import vscode, { CodeActionKind } from 'vscode';
import { DiagnosticFilter, isDefined } from '../utils';
import { commandFromRequest, toConfidenceSymbol } from './commands';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';

export class CsRefactorCodeAction implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [CodeActionKind.QuickFix, CodeActionKind.Empty];

  public constructor(private codeSmellFilter: DiagnosticFilter) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const uniqueRequests = new Set<CsRefactoringRequest>();

    context.diagnostics.filter(this.codeSmellFilter).forEach((diagnostic) => {
      const refacRequest = CsRefactoringRequests.get(document, diagnostic);
      if (!refacRequest?.shouldPresent()) return;
      uniqueRequests.add(refacRequest);
    });

    const codeActions: vscode.CodeAction[] = [];
    uniqueRequests.forEach((request) => {
      const action = toCodeAction(request);
      isDefined(action) && codeActions.push(action);
    });

    return codeActions;
  }
}

function toCodeAction(request: CsRefactoringRequest) {
  if (request.isPending()) return;

  let codeActionKind;
  let command = commandFromRequest(request);
  if (!isDefined(command)) return;

  const symbol = toConfidenceSymbol(request);
  switch (request.resolvedResponse?.confidence.level) {
    case 3:
    case 2:
      codeActionKind = CodeActionKind.QuickFix;
      break;
    case 1:
      codeActionKind = CodeActionKind.Empty;
      // Override title, worded as an action instead of a noun
      command.title = `${symbol} View code improvement guide`;
      break;
    default:
      codeActionKind = CodeActionKind.Empty;
      // Override title here as well
      command.title = `${symbol} View Auto-refactor error`;
      break;
  }
  
  // Note that CodeActionKind.Empty does not appear in the problems context menu, only in the
  // light bulb/editor context menu under "More actions..."
  const codeAction = new vscode.CodeAction(command.title, codeActionKind);
  codeAction.command = command;
  return codeAction;
}
