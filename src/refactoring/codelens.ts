import * as vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { logOutputChannel, outputChannel } from '../log';
import { isDefined, rangeStr } from '../utils';
import { commandFromLevel } from './command';
import CsRefactoringRequests, { CsRefactoringRequest } from './cs-refactoring-requests';

export class CsRefactorCodeLens extends vscode.CodeLens {
  readonly document: vscode.TextDocument;
  readonly csRefactoringRequest: CsRefactoringRequest | CsRefactoringRequest[];

  constructor(
    range: vscode.Range,
    document: vscode.TextDocument,
    csRefactoringRequest: CsRefactoringRequest | CsRefactoringRequest[],
    command?: vscode.Command
  ) {
    super(range, command);
    this.document = document;
    this.csRefactoringRequest = csRefactoringRequest;
  }
}

export class CsRefactorCodeLensProvider implements vscode.CodeLensProvider<CsRefactorCodeLens> {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  constructor(private codeSmellFilter: (d: vscode.Diagnostic) => boolean) {
    outputChannel.appendLine('Creating Auto-refactor CodeLens provider');
  }

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
    if (!getConfiguration('enableCodeLenses')) {
      return [];
    }

    const supportedDiagnostics = vscode.languages.getDiagnostics(document.uri).filter(this.codeSmellFilter);

    const requests: CsRefactoringRequest[] = [];
    const lenses = supportedDiagnostics
      .map((csDiag) => {
        const request = CsRefactoringRequests.get(csDiag);
        if (request && !request.error) {
          // Create RefactorCodeLenses for non-error requests (only show errors in the log)
          requests.push(request);
          return new CsRefactorCodeLens(csDiag.range, document, request);
        }
      })
      .filter(isDefined);

    if (lenses.length > 0) {
      const summaryLens = new CsRefactorCodeLens(new vscode.Range(0, 0, 0, 0), document, requests);
      lenses.unshift(summaryLens);
    }

    return lenses;
  }

  resolveCodeLens?(
    codeLens: CsRefactorCodeLens,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<CsRefactorCodeLens> {
    if (codeLens.csRefactoringRequest instanceof Array) {
      logOutputChannel.debug(`Resolving Auto-refactor Summary! ${codeLens.document.fileName.split('/').pop()}`);
      let title = `Auto-refactor: ${this.summaryString(codeLens.csRefactoringRequest)}`;
      let command = 'noop';
      codeLens.command = { title, command };
      return codeLens;
    }

    const request = codeLens.csRefactoringRequest;
    logOutputChannel.debug(
      `Resolving Auto-refactor CodeLens ${codeLens.document.fileName.split('/').pop()}:"${request.fnToRefactor.name}" ${
        codeLens.csRefactoringRequest && rangeStr(request.fnToRefactor.range)
      }`
    );

    const { resolvedResponse } = request; // error requests should not have been provided (see above)
    if (!resolvedResponse) {
      let title = '🛠️ Auto-refactor pending...';
      let command = 'noop';
      codeLens.command = { title, command };
      return codeLens;
    }

    codeLens.command = commandFromLevel(resolvedResponse.confidence.level, {
      document: codeLens.document,
      fnToRefactor: request.fnToRefactor,
      refactorResponse: resolvedResponse,
    });

    return codeLens;
  }

  private summaryString(csRefactoringRequest: CsRefactoringRequest[]) {
    const nPending = csRefactoringRequest.filter((r) => !r.resolvedResponse && !r.error).length;
    const doneResponses = csRefactoringRequest.map((r) => r.resolvedResponse).filter(isDefined);
    const nRefactorings = doneResponses.filter((r) => r.confidence.level >= 2).length;
    const nCodeReviews = doneResponses.filter((r) => r.confidence.level === 1).length;
    const pendingString = nPending > 0 ? `${nPending} pending` : undefined;
    const nRefacString =
      nRefactorings > 0 ? `${nRefactorings} ${this.pluralize('refactoring', nRefactorings)}` : undefined;
    const nCodeReviewsString =
      nCodeReviews > 0 ? `${nCodeReviews} ${this.pluralize('code review', nCodeReviews)}` : undefined;
    return [pendingString, nRefacString, nCodeReviewsString].filter(isDefined).join(', ');
  }

  private pluralize(word: string, n: number) {
    return n === 1 ? word : `${word}s`;
  }

  update() {
    this.onDidChangeCodeLensesEmitter.fire();
  }
}
