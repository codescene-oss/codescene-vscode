import * as vscode from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { toDocsParams } from '../documentation/commands';
import { reviewDocumentSelector } from '../language-support';
import { RefactoringTarget } from '../refactoring/capabilities';
import { isDefined } from '../utils';
import Reviewer from './reviewer';
import { getCsDiagnosticCode } from './utils';

export function register(context: vscode.ExtensionContext) {
  const codeActionProvider = new ReviewCodeActionProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(reviewDocumentSelector(), codeActionProvider),
    codeActionProvider
  );
}

class ReviewCodeActionProvider implements vscode.CodeActionProvider, vscode.Disposable {
  readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Empty];
  private disposables: vscode.Disposable[] = [];

  constructor() {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ) {
    const review = Reviewer.instance.reviewCache.get(document);
    if (!review) return;

    const diagnostics: vscode.Diagnostic[] = await review.review.diagnostics;
    const actions: vscode.CodeAction[] = [];
    const diagnosticsInRange = diagnostics.filter((diagnostic) => diagnostic.range.contains(range));

    const refactoringTargets = diagnosticsInRange
      .map((diagnostic) => {
        const category = getCsDiagnosticCode(diagnostic.code);
        if (!category) return;
        return {
          category,
          line: diagnostic.range.start.line + 1,
        } as RefactoringTarget;
      })
      .filter(isDefined);

    const fnToRefactor = (
      await CsExtensionState.aceCapabilities?.getFunctionsToRefactor(document, refactoringTargets)
    )?.[0];

    if (fnToRefactor) {
      const refactorAction = new vscode.CodeAction('Refactor using CodeScene ACE', vscode.CodeActionKind.QuickFix);
      refactorAction.command = {
        command: 'codescene.requestAndPresentRefactoring',
        title: 'Refactor using CodeScene ACE',
        arguments: [document, fnToRefactor],
      };
      actions.push(refactorAction);
    }

    diagnosticsInRange.forEach((diagnostic) => {
      const category = getCsDiagnosticCode(diagnostic.code);
      if (!category) return;
      const title = `Explain ${category}`;
      const action = new vscode.CodeAction(title, vscode.CodeActionKind.Empty);
      action.diagnostics = [diagnostic];
      action.command = {
        command: 'codescene.openInteractiveDocsPanel',
        title,
        arguments: [toDocsParams(category, diagnostic.range.start, document, fnToRefactor)],
      };
      actions.push(action);
    });

    if (actions.length === 0) return;

    return actions;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
