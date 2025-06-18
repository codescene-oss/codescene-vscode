import vscode, { WorkspaceEdit } from 'vscode';
import { CodeSceneTabPanel } from '../codescene-tab/webview-panel';
import { CsExtensionState } from '../cs-extension-state';
import { FnToRefactor } from '../devtools-api/refactor-models';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import Telemetry from '../telemetry';
import { RefactoringRequest } from './request';
import { createTempDocument, decorateCode, selectCode, targetEditor } from './utils';

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

  private async requestAndPresentRefactoringCmd(
    document: vscode.TextDocument,
    source: string,
    fnToRefactor?: FnToRefactor,
    skipCache?: boolean
  ) {
    if (!fnToRefactor) return;
    if (!CsExtensionState.acknowledgedAceUsage) {
      Telemetry.logUsage('ace-info/presented', { source });
      CodeSceneTabPanel.show({ document, fnToRefactor });
      return;
    }

    const request = new RefactoringRequest(fnToRefactor, document, skipCache);
    Telemetry.logUsage('refactor/requested', { source, ...request.eventData });
    CodeSceneTabPanel.show(request);
  }

  private async applyRefactoringCmd(refactoring: RefactoringRequest) {
    const {
      document,
      fnToRefactor,
      fnToRefactor: { vscodeRange },
    } = refactoring;

    return refactoring.promise.then(async (response) => {
      const editor = targetEditor(document);
      await vscode.window.showTextDocument(document.uri, { preview: false, viewColumn: editor?.viewColumn, });
      const workSpaceEdit = new WorkspaceEdit();
      workSpaceEdit.replace(document.uri, vscodeRange, response.code);
      await vscode.workspace.applyEdit(workSpaceEdit);
      // Select the replaced code in the editor, starting from the original position
      await selectCode(document, response.code, vscodeRange.start);
      await vscode.commands.executeCommand('editor.action.formatSelection');

      // Immediately trigger a re-review of the new file-content
      // This is important, since otherwise the review is controlled by the debounced review done in the onDidChangeTextDocument (extension.ts)
      CsDiagnostics.review(document);
      Telemetry.logUsage('refactor/applied', refactoring.eventData);
    });
  }

  private async showDiffForRefactoringCmd(refactoring: RefactoringRequest) {
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
