import { basename } from 'path';
import vscode, { Range, WorkspaceEdit } from 'vscode';
import { AbortError } from '../devtools-api/abort-error';
import { RefactorResponse } from '../devtools-api/refactor-models';
import Telemetry from '../telemetry';
import { RefactoringRequest } from './request';

export const UNDO_GOAL_FIX = 'Undo';

export async function replaceDocument(document: vscode.TextDocument, code: string): Promise<void> {
  const fullDocumentRange = new Range(document.positionAt(0), document.positionAt(document.getText().length));
  const workSpaceEdit = new WorkspaceEdit();
  workSpaceEdit.replace(document.uri, fullDocumentRange, code);
  await vscode.workspace.applyEdit(workSpaceEdit);
}

async function awaitResponse(request: RefactoringRequest): Promise<RefactorResponse | undefined> {
  try {
    return await request.promise;
  } catch (e) {
    if (!(e instanceof AbortError)) {
      void vscode.window.showErrorMessage(`The Refactoring Agent could not fix ${basename(request.document.fileName)}. See the CodeScene output for details.`);
    }
    return undefined;
  }
}

async function offerUndo(request: RefactoringRequest, response: RefactorResponse): Promise<void> {
  const { document, fnToRefactor } = request;
  const details = response.confidence['recommended-action'].details;
  const choice = await vscode.window.showInformationMessage(
    `The Refactoring Agent changed ${basename(document.fileName)}. ${details}.`,
    UNDO_GOAL_FIX
  );
  if (choice !== UNDO_GOAL_FIX) return;

  if (document.getText() !== response.code) {
    void vscode.window.showWarningMessage(`${basename(document.fileName)} changed after the goal fix was applied, so it was not undone.`);
    return;
  }
  await replaceDocument(document, fnToRefactor.body);
}

export async function runGoalFix(request: RefactoringRequest): Promise<void> {
  const response = await awaitResponse(request);
  if (!response) return;

  const { document, fnToRefactor } = request;
  if (response['goal-outcome'] === 'unable' || response.code === fnToRefactor.body) {
    void vscode.window.showInformationMessage(
      `The Refactoring Agent found no change that improves ${basename(document.fileName)} towards the goal.`
    );
    return;
  }

  if (document.getText() !== fnToRefactor.body) {
    void vscode.window.showWarningMessage('The file changed after the CodeScene Refactoring Agent read it. Run the goal fix again on the current file.');
    return;
  }

  await replaceDocument(document, response.code);
  Telemetry.logUsage('refactor/applied', request.eventData);
  void offerUndo(request, response);
}
