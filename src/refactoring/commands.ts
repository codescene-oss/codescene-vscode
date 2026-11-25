import path from 'path';
import vscode, { ViewColumn, WorkspaceEdit } from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { FnToRefactor } from '../devtools-api/refactor-models';
import { RefactoringRequest } from './request';
import { ensureSavedForRefactoring } from './unsaved-changes';
import { createTempDocument, decorateCode, findFnToRefactor, selectCode, targetEditor } from './utils';
import { reportError } from '../utils';
import { CodeSceneCWFAceTabPanel } from '../codescene-tab/webview/ace/cwf-webview-ace-panel';
import { CodeSceneCWFAceAcknowledgementTabPanel } from '../codescene-tab/webview/ace/acknowledgement/cwf-webview-ace-acknowledgement-panel';
import { logOutputChannel } from '../log';
import { CodeSmell } from '../devtools-api/review-model';
import { FixGoalTarget } from './agent-types';
import { fnToRefactorForGoal } from './fn-to-refactor';
import { replaceDocument, runGoalFix } from './goal-fix';
import { fixGoalJobs } from '../objectives/fix-goal-jobs';
import { logAiStage, logPanelStage } from './ai-telemetry';

/**
 * Locate the view column of an existing tab for the given document, even when the document
 * is not the active tab in its group (e.g. when a diff tab is on top of it).
 */
function findDocumentTabViewColumn(document: vscode.TextDocument): ViewColumn | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString()) {
        return group.viewColumn;
      }
    }
  }
  return undefined;
}

export class CsRefactoringCommands implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.commands.registerCommand(
        'codescene.requestAndPresentRefactoring',
        this.requestAndPresentRefactoringCmd,
        this
      ),
      vscode.commands.registerCommand('codescene.applyRefactoring', this.applyRefactoringCmd, this),
      vscode.commands.registerCommand('codescene.showDiffForRefactoring', this.showDiffForRefactoringCmd, this)
    );
  }

  // @codescene(disable:"Excess Number of Function Arguments")
  private async requestAndPresentRefactoringCmd(
    document: vscode.TextDocument,
    source: string,
    fnToRefactor?: FnToRefactor,
    skipCache?: boolean,
    codeSmell?: CodeSmell,
    goal?: FixGoalTarget
  ) {
    if (goal) {
      await this.fixGoal(document, source, skipCache, goal);
      return;
    }

    const toRefactor = await this.prepareFnToRefactor(document, fnToRefactor, codeSmell);
    if (!toRefactor) return;

    const request = new RefactoringRequest(toRefactor, document, skipCache);
    if (this.presentAcknowledgement(request, source)) return;

    request.source = source;
    logAiStage(request, 'requested');
    CodeSceneCWFAceTabPanel.show(request);
  }

  private presentAcknowledgement(request: RefactoringRequest, source: string): boolean {
    if (CsExtensionState.acknowledgedAceUsage) return false;
    CodeSceneCWFAceAcknowledgementTabPanel.show(request);
    return true;
  }

  private async fixGoal(document: vscode.TextDocument, source: string, skipCache: boolean | undefined, goal: FixGoalTarget) {
    const fileName = path.join(goal.repoRoot, goal.path);
    if (!fixGoalJobs.add(goal.goalId, fileName)) {
      logOutputChannel.info(`[fix-goal] Ignoring goal ${goal.goalId} ${goal.path}: it is already being fixed`);
      return;
    }

    try {
      if (!(await ensureSavedForRefactoring(document))) return;

      const request = new RefactoringRequest(fnToRefactorForGoal(document, goal), document, skipCache, goal);
      if (this.presentAcknowledgement(request, source)) return;

      request.source = source;
      logAiStage(request, 'requested');
      await runGoalFix(request);
    } finally {
      fixGoalJobs.remove(goal.goalId, fileName);
    }
  }

  private async prepareFnToRefactor(
    document: vscode.TextDocument,
    fnToRefactor: FnToRefactor | undefined,
    codeSmell: CodeSmell | undefined
  ): Promise<FnToRefactor | undefined> {
    const toRefactor = fnToRefactor ?? (await findFnToRefactor(document, codeSmell));
    if (!toRefactor) {
      logOutputChannel.error('Could not refactor. Function to refactor is undefined.');
      return undefined;
    }
    if (!(await ensureSavedForRefactoring(document))) return undefined;
    return toRefactor;
  }

  private async applyRefactoringCmd(refactoring: RefactoringRequest) {
    const {
      document,
      fnToRefactor: { vscodeRange },
    } = refactoring;

    return refactoring.promise.then(async (response) => {
      // Close any lingering Show Diff tabs.
      try {
        await this.closeExistingDiffTabs();
      } catch (e) {
        reportError({ e, context: 'Error closing diff tabs' });
      }

      const viewColumn = targetEditor(document)?.viewColumn ?? findDocumentTabViewColumn(document) ?? ViewColumn.One;
      await vscode.window.showTextDocument(document.uri, { preview: false, viewColumn });

      if (refactoring.goal) {
        if (document.getText() !== refactoring.fnToRefactor.body) {
          void vscode.window.showWarningMessage('The file changed after the CodeScene Refactoring Agent read it. Run the goal fix again on the current file.');
          return;
        }
        await replaceDocument(document, response.code);
      } else {
        const workSpaceEdit = new WorkspaceEdit();
        workSpaceEdit.replace(document.uri, vscodeRange, response.code);
        await vscode.workspace.applyEdit(workSpaceEdit);
        // Select the replaced code in the editor, starting from the original position
        await selectCode(document, response.code, vscodeRange.start);
        await vscode.commands.executeCommand('editor.action.formatSelection');
      }

      logPanelStage(refactoring, 'applied');
    });
  }

  private async closeExistingDiffTabs() {
    const tabsToClose = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          (tab.input.original.scheme === 'tmp-diff' || tab.input.modified.scheme === 'tmp-diff')
      );

    for (const tab of tabsToClose) {
      await vscode.window.tabGroups.close(tab);
    }
  }

  private async showDiffForRefactoringCmd(refactoring: RefactoringRequest) {
    // Close any existing diff tabs before opening a new one.
    // This ensures that hitting the 'Show Diff' button can be clicked multiple times without creating new Diff panes (CS-5755).
    // This is the best possible approach atm, since VS Code doesn't offer an API to focus on a specific tab (https://github.com/microsoft/vscode/issues/162446)
    try {
      await this.closeExistingDiffTabs();
    } catch (e) {
      reportError({e, context: "Error closing diff tabs"});
    }
    const {
      document,
      fnToRefactor: { vscodeRange },
    } = refactoring;

    const response = await refactoring.promise;
    const decoratedCode = decorateCode(response, document.languageId);
    // Create temporary virtual documents to use in the diff command. Just opening a new document with the new code
    // imposes a save dialog on the user when closing the diff.
    const originalCodeTmpDoc = await createTempDocument('Original', {
      content: document.getText(vscodeRange),
      languageId: document.languageId,
    });
    const refactoringTmpDoc = await createTempDocument('Refactoring', {
      content: decoratedCode,
      languageId: document.languageId,
    });

    // Use showTextDocument using the tmp doc and the target editor view column to set that editor active.
    // The diff command will then open in that same viewColumn, and not on top of the ACE panel.
    const viewColumn = targetEditor(document)?.viewColumn ?? findDocumentTabViewColumn(document) ?? ViewColumn.One;
    await vscode.window.showTextDocument(originalCodeTmpDoc, viewColumn, false);
    await vscode.commands.executeCommand('vscode.diff', originalCodeTmpDoc.uri, refactoringTmpDoc.uri);

    logPanelStage(refactoring, 'diff-shown');
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
