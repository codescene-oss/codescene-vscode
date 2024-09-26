import * as vscode from 'vscode';
import { toDocsParams } from '../documentation/csdoc-provider';
import { reviewDocumentSelector } from '../language-support';
import { AceAPI } from '../refactoring/addon';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import { isDefined } from '../utils';
import Reviewer from './reviewer';
import { getCsDiagnosticCode } from './utils';

export function register(context: vscode.ExtensionContext, aceApi?: AceAPI) {
  const codeActionProvider = new ReviewCodeActionProvider(aceApi);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(reviewDocumentSelector(), codeActionProvider),
    codeActionProvider
  );
}

class ReviewCodeActionProvider implements vscode.CodeActionProvider, vscode.Disposable {
  readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Empty];
  private disposables: vscode.Disposable[] = [];

  private requestsForDocument = new Map<string, CsRefactoringRequest[]>();

  constructor(aceApi?: AceAPI) {
    if (aceApi) {
      this.disposables.push(
        aceApi.onDidChangeRequests((event) => {
          if (event.requests) {
            this.requestsForDocument.set(event.document.uri.toString(), event.requests);
          }
        })
      );
    }
  }

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ) {
    const review = Reviewer.instance.reviewCache.get(document);
    if (!review) return;

    const diagnostics: vscode.Diagnostic[] = await review.review.diagnostics;

    const actions = diagnostics
      .filter((diagnostic) => diagnostic.range.contains(range))
      .map((diagnostic) => {
        const category = getCsDiagnosticCode(diagnostic.code);
        if (!category) return;
        const title = `Explain ${category}`;
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.Empty);
        action.diagnostics = [diagnostic];
        action.command = {
          command: 'codescene.openInteractiveDocsPanel',
          title,
          arguments: [toDocsParams(category, diagnostic.range.start, document.uri)],
        };
        return action;
      })
      .filter(isDefined);

    if (actions.length === 0) return;

    const refactoringRequests = this.requestsForDocument.get(document.uri.toString());
    const matchingRequest = refactoringRequests?.find((request) => request.fnToRefactor.range.contains(range));
    if (matchingRequest) {
      const refactorAction = new vscode.CodeAction('Refactor using CodeScene ACE', vscode.CodeActionKind.QuickFix);
      refactorAction.command = {
        command: 'codescene.presentRefactoring',
        title: 'Refactor using CodeScene ACE',
        arguments: [matchingRequest],
      };
      actions.unshift(refactorAction);
    }

    return actions;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
