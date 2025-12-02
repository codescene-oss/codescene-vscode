import vscode, { WorkspaceEdit } from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { FnToRefactor } from '../devtools-api/refactor-models';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import Telemetry from '../telemetry';
import { RefactoringRequest } from './request';
import { createTempDocument, decorateCode, findFnToRefactor, selectCode, targetEditor } from './utils';
import { reportError } from '../utils';
import { CodeSceneCWFAceTabPanel } from '../codescene-tab/webview/ace/cwf-webview-ace-panel';
import { CodeSceneCWFAceAcknowledgementTabPanel } from '../codescene-tab/webview/ace/acknowledgement/cwf-webview-ace-acknowledgement-panel';
import { logOutputChannel } from '../log';
import { CodeSmell } from '../devtools-api/review-model';

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
    codeSmell?: CodeSmell
  ) {
    const toRefactor = fnToRefactor ?? (await findFnToRefactor(document, codeSmell));
    if (!toRefactor) {
      logOutputChannel.error('Could not refactor. Function to refactor is undefined.');
      return;
    }

    if (!CsExtensionState.acknowledgedAceUsage) {
      Telemetry.logUsage('ace-info/presented', { source });
      CodeSceneCWFAceAcknowledgementTabPanel.show(new RefactoringRequest(toRefactor, document, skipCache));
      return;
    }

    const request = new RefactoringRequest(toRefactor, document, skipCache);
    Telemetry.logUsage('refactor/requested', { source, ...request.eventData });
    CodeSceneCWFAceTabPanel.show(request);
  }

  private async applyRefactoringCmd(refactoring: RefactoringRequest) {
    const {
      document,
      fnToRefactor: { vscodeRange },
    } = refactoring;

    return refactoring.promise.then(async (response) => {
      const editor = targetEditor(document);
      await vscode.window.showTextDocument(document.uri, { preview: false, viewColumn: editor?.viewColumn });
      const workSpaceEdit = new WorkspaceEdit();
      workSpaceEdit.replace(document.uri, vscodeRange, response.code);
      await vscode.workspace.applyEdit(workSpaceEdit);
      // Select the replaced code in the editor, starting from the original position
      await selectCode(document, response.code, vscodeRange.start);
      await vscode.commands.executeCommand('editor.action.formatSelection');

      Telemetry.logUsage('refactor/applied', refactoring.eventData);
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
    const editor = targetEditor(document);
    await vscode.window.showTextDocument(originalCodeTmpDoc, editor?.viewColumn, false);
    await vscode.commands.executeCommand('vscode.diff', originalCodeTmpDoc.uri, refactoringTmpDoc.uri);

    Telemetry.logUsage('refactor/diff-shown', refactoring.eventData);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
