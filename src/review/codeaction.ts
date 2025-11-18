import * as vscode from 'vscode';
import { DevtoolsAPI } from '../devtools-api';
import { Review } from '../devtools-api/review-model';
import { CsDiagnostic } from '../diagnostics/cs-diagnostic';
import { toDocsParamsRanged } from '../documentation/commands';
import { reviewDocumentSelector } from '../language-support';
import { isDefined } from '../utils';
import Reviewer from './reviewer';
import { getAuthToken } from '../configuration';
import { fnsToRefactorCache } from '../devtools-api/fns-to-refactor-cache';

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
    const reviewCacheItem = Reviewer.instance.reviewCache.get(document);
    if (!reviewCacheItem) return;

    const diagnostics: CsDiagnostic[] = await reviewCacheItem.review.diagnostics;
    const actions: vscode.CodeAction[] = [];
    const diagnosticsInRange = diagnostics.filter((diagnostic) => diagnostic.range.contains(range));

    const codeSmells = diagnosticsInRange
      .filter((diagnostic) => diagnostic.range.contains(range))
      .map((diagnostic) => diagnostic.codeSmell)
      .filter(isDefined);

    const authToken = getAuthToken();

    const fnsToRefactor = await Promise.all(
      codeSmells.map((codeSmell) => fnsToRefactorCache.fnsToRefactor(document, codeSmell))
    );
    const fnToRefactor = fnsToRefactor.find(isDefined);

    // Get review result to extract function range info when fnToRefactor is not available
    const reviewResultRaw = await reviewCacheItem.review.reviewResult;
    const reviewResult: Review | undefined = reviewResultRaw && typeof reviewResultRaw === 'object' ? reviewResultRaw : undefined;

    if (fnToRefactor) {
      const refactorHighligting = new vscode.Diagnostic(fnToRefactor.vscodeRange, 'Function to refactor');
      const refactorAction = new vscode.CodeAction('Refactor using CodeScene ACE', vscode.CodeActionKind.QuickFix);
      refactorAction.diagnostics = [refactorHighligting];
      refactorAction.command = {
        command: 'codescene.requestAndPresentRefactoring',
        title: 'Refactor using CodeScene ACE',
        arguments: [document, 'codeaction', fnToRefactor],
      };
      refactorAction.disabled = !authToken
        ? {
            reason: 'Refactoring is not available. Please verify your authentication token in Workspace settings.',
          }
        : undefined;
      actions.push(refactorAction);
    }

    codeSmells.forEach((codeSmell) => {
      const { category, 'highlight-range': range } = codeSmell;

      if (!category) return;
      const title = `Explain ${category}`;
      const action = new vscode.CodeAction(title, vscode.CodeActionKind.Empty);
      action.diagnostics = diagnosticsInRange;
      action.command = {
        command: 'codescene.openInteractiveDocsPanel',
        title,
        arguments: [toDocsParamsRanged(category, document, codeSmell, fnToRefactor, reviewResult), 'codeaction'],
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
