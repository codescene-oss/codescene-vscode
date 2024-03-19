import * as vscode from 'vscode';
import { getConfiguration, onDidChangeConfiguration } from '../configuration';
import { logOutputChannel, outputChannel } from '../log';
import { DiagnosticFilter, isDefined, rangeStr } from '../utils';
import { commandFromRequest, pendingSymbol } from './commands';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';

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

export class CsRefactorCodeLensProvider implements vscode.CodeLensProvider<CsRefactorCodeLens>, vscode.Disposable {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  private disposables: vscode.Disposable[] = [];

  constructor(private codeSmellFilter: DiagnosticFilter) {
    outputChannel.appendLine('Creating Auto-refactor CodeLens provider');
    this.disposables.push(
      CsRefactoringRequests.onDidChangeRequests(() => {
        this.onDidChangeCodeLensesEmitter.fire();
      })
    );
    this.disposables.push(onDidChangeConfiguration('enableCodeLenses', () => this.onDidChangeCodeLensesEmitter.fire()));
  }

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
    if (!getConfiguration('enableCodeLenses')) {
      return [];
    }

    const supportedDiagnostics = vscode.languages.getDiagnostics(document.uri).filter(this.codeSmellFilter);

    // Map unique positions in the code to a CodeLens
    const positionToCodeLens: Map<string, CsRefactorCodeLens> = new Map();
    const positionKey = (pos: vscode.Position) => `${pos.line}`;

    supportedDiagnostics.forEach((diagnostic) => {
      const request = CsRefactoringRequests.get(document, diagnostic);
      if (!request) return;

      if (request.isPending() || request.validConfidenceLevel()) {
        // Add a lens at the start of the function targeted for refactoring
        positionToCodeLens.set(
          positionKey(request.fnToRefactor.range.start),
          new CsRefactorCodeLens(request.fnToRefactor.range, document, request)
        );
      }
    });

    const lenses = Array.from(positionToCodeLens.values());
    this.addSummaryLens(document, lenses);
    return lenses;
  }

  /**
   * The summary lens summarizes the number of actual code lenses shown to the user - not the number of unique refactorings.
   */
  private addSummaryLens(document: vscode.TextDocument, lenses: CsRefactorCodeLens[]) {
    if (lenses.length > 0) {
      const requests = lenses
        .map((lens) =>
          lens.csRefactoringRequest instanceof CsRefactoringRequest ? lens.csRefactoringRequest : undefined
        )
        .filter(isDefined)
        .filter((req, i, reqs) => reqs.findIndex((r) => r.fnToRefactor.content === req.fnToRefactor.content) === i);
      const summaryLens = new CsRefactorCodeLens(new vscode.Range(0, 0, 0, 0), document, requests);
      lenses.unshift(summaryLens);
    }
  }

  resolveCodeLens?(
    codeLens: CsRefactorCodeLens,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<CsRefactorCodeLens> {
    if (codeLens.csRefactoringRequest instanceof Array) {
      logOutputChannel.debug(`Resolving Auto-refactor Summary! ${codeLens.document.fileName.split('/').pop()}`);
      codeLens.command = {
        title: `Auto-refactor: ${this.summaryString(codeLens.csRefactoringRequest)}`,
        command: 'codescene.explorerAutoRefactorView.focus',
      };
      return codeLens;
    }

    const request = codeLens.csRefactoringRequest;
    logOutputChannel.debug(
      `Resolving Auto-refactor CodeLens ${codeLens.document.fileName.split('/').pop()}:"${request.fnToRefactor.name}" ${
        codeLens.csRefactoringRequest && rangeStr(request.fnToRefactor.range)
      }`
    );

    const response = request.resolvedResponse();

    if (!isDefined(response)) {
      codeLens.command = {
        title: `${pendingSymbol} Auto-refactoring...`,
        command: 'codescene.explorerAutoRefactorView.focus',
      };
      return codeLens;
    }

    codeLens.command = commandFromRequest(response);
    return codeLens;
  }

  private summaryString(csRefactoringRequest: CsRefactoringRequest[]) {
    const nPending = csRefactoringRequest.filter((r) => r.isPending()).length;
    const doneResponses = csRefactoringRequest.map((r) => r.response).filter(isDefined);
    const nRefactorings = doneResponses.filter((r) => r.confidence.level >= 2).length;
    const nImprovementGuides = doneResponses.filter((r) => r.confidence.level === 1).length;
    const pendingString = nPending > 0 ? `${nPending} pending` : undefined;
    const nRefacString =
      nRefactorings > 0 ? `${nRefactorings} ${this.pluralize('refactoring', nRefactorings)}` : undefined;
    const nCodeImprovementString =
      nImprovementGuides > 0
        ? `${nImprovementGuides} ${this.pluralize('improvement guide', nImprovementGuides)}`
        : undefined;
    return [pendingString, nRefacString, nCodeImprovementString].filter(isDefined).join(', ');
  }

  private pluralize(word: string, n: number) {
    return n === 1 ? word : `${word}s`;
  }
}
