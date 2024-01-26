import vscode, { TextDocument, window } from 'vscode';
import { findEnclosingFunction } from '../codescene-interop';
import { CsRestApi, RefactorResponse } from '../cs-rest-api';
import { CsRefactoringRequest } from './cs-refactoring-requests';
import { RefactoringPanel } from './refactoring-panel';

export const requestRefactoringCmdName = 'codescene.requestRefactoring';
export const showRefactoringCmdName = 'codescene.showRefactoring';

export interface FnToRefactor {
  name: string;
  range: vscode.Range;
  content: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'file-type': string;
  functionType: string;
}

export class CsRefactoringCommand {
  private readonly csRestApi: CsRestApi;
  private readonly cliPath: string;
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, csRestApi: CsRestApi, cliPath: string) {
    this.context = context;
    this.csRestApi = csRestApi;
    this.cliPath = cliPath;
  }

  register() {
    const requestRefactoringCmd = vscode.commands.registerCommand(
      requestRefactoringCmdName,
      this.requestRefactoring,
      this
    );
    this.context.subscriptions.push(requestRefactoringCmd);
    const showRefactoringCmd = vscode.commands.registerCommand(
      showRefactoringCmdName,
      this.showRefactoring,
      this
    );
    this.context.subscriptions.push(showRefactoringCmd);
  }

  showRefactoring(document: vscode.TextDocument, fnToRefactor: FnToRefactor, refactorResponse: RefactorResponse) {
    const editor = window.activeTextEditor;
    if (editor) {
      editor.selection = new vscode.Selection(fnToRefactor.range.start, fnToRefactor.range.end);
      editor.revealRange(fnToRefactor.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    const initiatorViewColumn = editor?.viewColumn;

    RefactoringPanel.createOrShow({
      extensionUri: this.context.extensionUri,
      document,
      initiatorViewColumn,
      fnToRefactor,
      response: refactorResponse,
    });
  }

  async requestRefactoring(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): Promise<CsRefactoringRequest | undefined> {
    const fnToRefactor = await findFunctionToRefactor(this.cliPath, document, diagnostic.range);
    if (!fnToRefactor) {
      console.error('CodeScene: Could not find a suitable function to refactor.');
      window.showErrorMessage('Could not find a suitable function to refactor.');
      return;
    }

    const req = new CsRefactoringRequest(this.csRestApi, diagnostic, fnToRefactor);
    return req;
  }
}

async function findFunctionToRefactor(cliPath: string, document: TextDocument, range: vscode.Range) {
  const extension = document.fileName.split('.').pop() || '';
  const enclosingFn = await findEnclosingFunction(
    cliPath,
    extension,
    range.start.line + 1, // range.start.line is zero-based
    document.getText()
  );

  if (!enclosingFn) return;

  // Note that vscode.Range line numbers are zero-based
  const enclosingFnRange = new vscode.Range(
    enclosingFn['start-line'] - 1,
    enclosingFn['start-column'],
    enclosingFn['end-line'] - 1,
    enclosingFn['end-column']
  );

  return {
    name: enclosingFn.name,
    range: enclosingFnRange,
    functionType: enclosingFn['function-type'],
    'file-type': extension,
    content: document.getText(enclosingFnRange),
  } as FnToRefactor;
}
