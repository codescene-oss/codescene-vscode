import { basename } from 'path';
import vscode, { Range, WorkspaceEdit } from 'vscode';
import { AbortError } from '../devtools-api/abort-error';
import { RefactorResponse } from '../devtools-api/refactor-models';
import Telemetry from '../telemetry';
import { AgentTimeoutError } from './agent-process';
import { RefactoringRequest } from './request';

export const OPEN_GOAL_FIX = 'Open';
export const UNDO_GOAL_FIX = 'Undo';

export async function replaceDocument(document: vscode.TextDocument, code: string): Promise<void> {
  const fullDocumentRange = new Range(document.positionAt(0), document.positionAt(document.getText().length));
  const workSpaceEdit = new WorkspaceEdit();
  workSpaceEdit.replace(document.uri, fullDocumentRange, code);
  await vscode.workspace.applyEdit(workSpaceEdit);
}

function awaitWithProgress(request: RefactoringRequest): Thenable<RefactorResponse> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Refactoring Agent: fixing ${basename(request.document.fileName)}`,
      cancellable: true,
    },
    (progress, token) => {
      void progress;
      token.onCancellationRequested(() => request.abort());
      return request.promise;
    }
  );
}

async function awaitResponse(request: RefactoringRequest): Promise<RefactorResponse | undefined> {
  try {
    return await awaitWithProgress(request);
  } catch (e) {
    if (e instanceof AbortError) return undefined;
    const reason = e instanceof AgentTimeoutError ? ` ${e.message}` : ' See the CodeScene output for details.';
    void vscode.window.showErrorMessage(`The Refactoring Agent could not fix ${basename(request.document.fileName)}.${reason}`);
    return undefined;
  }
}

async function applyAndSave(document: vscode.TextDocument, code: string): Promise<string> {
  await replaceDocument(document, code);
  await document.save();
  return document.getText();
}

async function offerOpenAndUndo(request: RefactoringRequest, response: RefactorResponse, applied: string): Promise<void> {
  const { document, fnToRefactor } = request;
  const details = response.confidence['recommended-action'].details;
  const choice = await vscode.window.showInformationMessage(
    `The Refactoring Agent changed ${basename(document.fileName)}. ${details}.`,
    OPEN_GOAL_FIX,
    UNDO_GOAL_FIX
  );
  if (choice === OPEN_GOAL_FIX) {
    await vscode.window.showTextDocument(document);
    return;
  }
  if (choice !== UNDO_GOAL_FIX) return;

  if (document.getText() !== applied) {
    void vscode.window.showWarningMessage(`${basename(document.fileName)} changed after the goal fix was applied, so it was not undone.`);
    return;
  }
  await applyAndSave(document, fnToRefactor.body);
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

  const applied = await applyAndSave(document, response.code);
  Telemetry.logUsage('refactor/applied', request.eventData);
  void offerOpenAndUndo(request, response, applied);
}
