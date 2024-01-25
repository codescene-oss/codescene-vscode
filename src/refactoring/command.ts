import vscode, { DocumentSymbol, SymbolKind, TextDocument, Uri, commands, window } from 'vscode';
import { RefactoringPanel } from './refactoring-panel';
import { CsRestApi, RefactorRequest, RefactorResponse } from '../cs-rest-api';
import axios, { AxiosError } from 'axios';
import { findEnclosingFunction } from '../codescene-interop';
import { env } from 'process';
import CsRefactoringRequests, { CsRefactoringRequest } from './cs-refactoring-requests';
import { keyStr } from '../utils';

export const refactoringRequestCmdName = 'codescene.refactoringRequest';
export const awaitAndShowRefactoringCmdName = 'codescene.awaitAndShowRefactoring';
export const requestAndShowRefactoringCmdName = 'codescene.requestAndShowRefactoring';
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
  private abortController: AbortController | undefined;

  constructor(context: vscode.ExtensionContext, csRestApi: CsRestApi, cliPath: string) {
    this.context = context;
    this.csRestApi = csRestApi;
    this.cliPath = cliPath;
  }

  register() {
    const requestAndShowRefactoringCmd = vscode.commands.registerCommand(
      requestAndShowRefactoringCmdName,
      this.requestAndShowRefactoring,
      this
    );
    this.context.subscriptions.push(requestAndShowRefactoringCmd);
    const refactoringRequestCmd = vscode.commands.registerCommand(
      refactoringRequestCmdName,
      this.refactoringRequest,
      this
    );
    this.context.subscriptions.push(refactoringRequestCmd);
    const awaitAndShowRefactoringCmd = vscode.commands.registerCommand(
      awaitAndShowRefactoringCmdName,
      this.awaitAndShowRefactoring,
      this
    );
    this.context.subscriptions.push(awaitAndShowRefactoringCmd);
  }

  /**
   *
   * @param context
   * @param document The document the user has invoked the refactoring on
   * @param refactorInitializationRange Where in the source code the user has invoked the refactoring
   * @param diagnostics List of valid CodeScene diagnostics. length guaranteed > 0. See refactor/codeaction.ts
   * for details on how the diagnostics are filtered.
   * @returns
   */
  async requestAndShowRefactoring(
    document: vscode.TextDocument,
    refactorInitializationRange: vscode.Range | vscode.Selection,
    diagnostics: vscode.Diagnostic[]
  ) {
    const diagnostic = diagnostics[0];
    const fnToRefactor = await findFunctionToRefactor(this.cliPath, document, diagnostic.range);
    if (!fnToRefactor) {
      console.error('CodeScene: Could not find a suitable function to refactor.');
      window.showErrorMessage('Could not find a suitable function to refactor.');
      return;
    }

    const editor = window.activeTextEditor;
    if (editor) {
      editor.selection = new vscode.Selection(fnToRefactor.range.start, fnToRefactor.range.end);
      editor.revealRange(fnToRefactor.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    const initiatorViewColumn = editor?.viewColumn;

    // Send abort signal to currently running refactoring request (if any)
    if (this.abortController) this.abortController.abort();

    this.abortController = new AbortController(); // New abort controller for the new request
    console.log(`CodeScene: Requesting refactoring suggestion for "${fnToRefactor.name}" from CodeScene's AI service`);

    const extensionUri = this.context.extensionUri;
    RefactoringPanel.createOrShow({ extensionUri, document, initiatorViewColumn, fnToRefactor });
    this.csRestApi
      .fetchRefactoring(diagnostic, fnToRefactor, this.abortController.signal)
      .then((response) => {
        RefactoringPanel.createOrShow({ extensionUri, document, initiatorViewColumn, fnToRefactor, response });
      })
      .catch((err: Error | AxiosError) => {
        if (err instanceof AxiosError && axios.isCancel(err)) {
          console.log('CodeScene: Previous refactor request cancelled.');
          return;
        }

        RefactoringPanel.createOrShow({
          extensionUri,
          document,
          initiatorViewColumn,
          fnToRefactor,
          response: err.message,
        });
      });
  }

  async awaitAndShowRefactoring(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    const diagnostic = diagnostics[0];
    const request = CsRefactoringRequests.get(diagnostic);
    if (!request) {
      console.log('CodeScene: Request was not initiated properly. (no function to refactor?)');
      // A user facing message should already have been shown in refactoringRequest()
      return;
    }

    const { fnToRefactor, refactorResponse } = request;

    const editor = window.activeTextEditor;
    if (editor) {
      editor.selection = new vscode.Selection(fnToRefactor.range.start, fnToRefactor.range.end);
      editor.revealRange(fnToRefactor.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    const initiatorViewColumn = editor?.viewColumn;

    // Present loading screen
    RefactoringPanel.createOrShow({
      extensionUri: this.context.extensionUri,
      document,
      initiatorViewColumn,
      fnToRefactor,
    });
    const response = await refactorResponse;
    RefactoringPanel.createOrShow({
      extensionUri: this.context.extensionUri,
      document,
      initiatorViewColumn,
      fnToRefactor,
      response,
    });
  }

  async refactoringRequest(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): Promise<CsRefactoringRequest | undefined> {
    const fnToRefactor = await findFunctionToRefactor(this.cliPath, document, diagnostic.range);
    if (!fnToRefactor) {
      console.error('CodeScene: Could not find a suitable function to refactor.');
      window.showErrorMessage('Could not find a suitable function to refactor.');
      return;
    }

    console.log(`CodeScene: ✨ Requesting refactoring suggestion for "${fnToRefactor.name}" from CodeScene's AI service`);
    const abortController = new AbortController();
    const refactorResponse = this.csRestApi
      .fetchRefactoring(diagnostic, fnToRefactor, abortController.signal)
      .catch((err: Error | AxiosError) => {
        let msg = `Refactoring error: ${err.message}`;
        if (err instanceof AxiosError) {
          msg = `Refactoring error: [${err.code}] ${err.message}`;
        }
        console.log(`CodeScene: ${msg}`);
        return msg;
      });

    return { fnToRefactor, abortController, refactorResponse };
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
