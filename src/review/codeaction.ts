import * as vscode from 'vscode';
import { Review } from '../devtools-api/review-model';
import { CsDiagnostic } from '../diagnostics/cs-diagnostic';
import { toDocsParamsRanged } from '../documentation/commands';
import { reviewDocumentSelector } from '../language-support';
import { isDefined } from '../utils';
import Reviewer from './reviewer';
import { getAuthToken } from '../configuration';
import { buildInsertText, getLineIndentation } from '../utils/codeaction-utils';

export function register(context: vscode.ExtensionContext) {
  const codeActionProvider = new ReviewCodeActionProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(reviewDocumentSelector(), codeActionProvider),
    codeActionProvider
  );

  const commentInsertedLineCmd = vscode.commands.registerCommand(
    'codescene.commentInsertedLine',
    async (documentUri: vscode.Uri, lineNumber: number) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.toString() !== documentUri.toString()) {
        return;
      }

      const line = editor.document.lineAt(lineNumber);
      editor.selection = new vscode.Selection(line.range.start, line.range.end);

      await vscode.commands.executeCommand('editor.action.addCommentLine');
    }
  );
  context.subscriptions.push(commentInsertedLineCmd);
}

export class ReviewCodeActionProvider implements vscode.CodeActionProvider, vscode.Disposable {
  readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Empty];
  private disposables: vscode.Disposable[] = [];

  constructor() {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ) {
    const reviewCacheItem = Reviewer.instance.reviewCache.get(document, "any");
    if (!reviewCacheItem) return;

    const diagnostics: CsDiagnostic[] = await reviewCacheItem.review.diagnostics;
    const diagnosticsInRange = diagnostics.filter((diagnostic) => diagnostic.range.contains(range));
    if (diagnosticsInRange.length === 0) return;

    const codeSmells = diagnosticsInRange
      .map((diagnostic) => diagnostic.codeSmell)
      .filter(isDefined);

    const actions: vscode.CodeAction[] = [];

    await this.addRefactorAction(document, codeSmells, actions);
    await this.addExplainActions(document, reviewCacheItem, codeSmells, diagnosticsInRange, actions);
    this.addDisableAction(document, diagnosticsInRange, actions);

    if (actions.length === 0) return;

    return actions;
  }

  private async addRefactorAction(
    document: vscode.TextDocument,
    codeSmells: any[],
    actions: vscode.CodeAction[]
  ) {
    const authToken = getAuthToken();

    // Only add refactor action if there's exactly one code smell (to avoid ambiguity)
    if (codeSmells.length !== 1) return;

    const codeSmell = codeSmells[0];
    if (!codeSmell) return;

    const refactorAction = new vscode.CodeAction('Refactor using CodeScene Agent', vscode.CodeActionKind.QuickFix);
    refactorAction.command = {
      command: 'codescene.requestAndPresentRefactoring',
      title: 'Refactor using CodeScene Agent',
      arguments: [document, 'codeaction', codeSmell],
    };
    refactorAction.disabled = !authToken
      ? {
          reason: 'Activate the refactoring agent by providing your authentication token in Workspace settings.',
        }
      : undefined;
    actions.push(refactorAction);
  }

  private async addExplainActions(
    document: vscode.TextDocument,
    reviewCacheItem: any,
    codeSmells: any[],
    diagnosticsInRange: CsDiagnostic[],
    actions: vscode.CodeAction[]
  ) {
    const reviewResultRaw = await reviewCacheItem.review.reviewResult;
    const reviewResult: Review | undefined = reviewResultRaw && typeof reviewResultRaw === 'object' ? reviewResultRaw : undefined;

    codeSmells.forEach((codeSmell) => {
      const { category } = codeSmell;
      if (!category) return;

      const title = `Explain ${category}`;
      const action = new vscode.CodeAction(title, vscode.CodeActionKind.Empty);
      action.diagnostics = diagnosticsInRange;
      action.command = {
        command: 'codescene.openInteractiveDocsPanel',
        title,
        arguments: [toDocsParamsRanged(category, document, codeSmell, { reviewResult }), 'codeaction'],
      };
      actions.push(action);
    });
  }

  private addDisableAction(
    document: vscode.TextDocument,
    diagnosticsInRange: CsDiagnostic[],
    actions: vscode.CodeAction[]
  ) {
    const firstDiagnostic = diagnosticsInRange[0];
    const category = firstDiagnostic.codeSmell?.category;
    if (!category) return;

    const sampleFixAction = new vscode.CodeAction(
      `Disable "${category}" for this line`,
      vscode.CodeActionKind.QuickFix
    );
    sampleFixAction.diagnostics = diagnosticsInRange;

    const edit = new vscode.WorkspaceEdit();
    const diagnosticLine = document.lineAt(firstDiagnostic.range.start.line);
    const insertText = buildInsertText(category, getLineIndentation(diagnosticLine.text));
    const insertPosition = new vscode.Position(firstDiagnostic.range.start.line, 0);
    const insertedLineNumber = firstDiagnostic.range.start.line;
    edit.insert(document.uri, insertPosition, insertText);

    sampleFixAction.edit = edit;
    sampleFixAction.command = {
      command: 'codescene.commentInsertedLine',
      title: 'Comment inserted line',
      arguments: [document.uri, insertedLineNumber],
    };

    actions.push(sampleFixAction);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
