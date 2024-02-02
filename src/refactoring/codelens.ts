import * as vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { logOutputChannel, outputChannel } from '../log';
import { isDefined, rangeStr } from '../utils';
import { commandFromLevel } from './command';
import CsRefactoringRequests, { CsRefactoringRequest } from './cs-refactoring-requests';

export class CsRefactorCodeLens extends vscode.CodeLens {
  readonly document: vscode.TextDocument;
  readonly csRefactoringRequest: CsRefactoringRequest;

  constructor(
    range: vscode.Range,
    document: vscode.TextDocument,
    csRefactoringRequest: CsRefactoringRequest,
    command?: vscode.Command
  ) {
    super(range, command);
    this.document = document;
    this.csRefactoringRequest = csRefactoringRequest;
  }
}

export class CsRefactorCodeLensProvider implements vscode.CodeLensProvider<CsRefactorCodeLens> {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  constructor(private supportedCodeSmells: string[]) {
    outputChannel.appendLine('Creating Auto Refactor CodeLens provider');
  }

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
    if (!getConfiguration('enableCodeLenses')) {
      return [];
    }

    const supportedDiagnostics = vscode.languages.getDiagnostics(document.uri).filter((d: vscode.Diagnostic) => {
      if (typeof d.code === 'object') {
        return this.supportedCodeSmells.includes(d.code.value.toString());
      }
      return false;
    });

    const lenses = supportedDiagnostics
      .map((csDiag) => {
        const request = CsRefactoringRequests.get(csDiag);
        if (!request) {
          return;
        }
        return new CsRefactorCodeLens(csDiag.range, document, request);
      })
      .filter(isDefined);

    return lenses;
  }

  resolveCodeLens?(
    codeLens: CsRefactorCodeLens,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<CsRefactorCodeLens> {
    logOutputChannel.debug(
      `Resolving Auto Refactor CodeLens ${codeLens.document.fileName.split('/').pop()}:${
        codeLens.csRefactoringRequest.fnToRefactor.name
      } [${rangeStr(codeLens.csRefactoringRequest.fnToRefactor.range)}]`
    );

    const { resolvedResponse, error } = codeLens.csRefactoringRequest;
    if (error) {
      logOutputChannel.debug(`   🤬 resolved with error ${error}!`);
      let title = '🤬 Auto Refactor error';
      let command = 'noop';
      codeLens.command = { title, command };
      return codeLens;
    }
    if (!resolvedResponse) {
      logOutputChannel.debug('   🛠️ response unresolved.');
      let title = '🛠️ Auto Refactor pending...';
      let command = 'noop';
      codeLens.command = { title, command };
      return codeLens;
    }

    logOutputChannel.debug(`   🎉 response resolved (confidence ${resolvedResponse.confidence.level})`);
    codeLens.command = commandFromLevel(resolvedResponse.confidence.level, {
      document: codeLens.document,
      fnToRefactor: codeLens.csRefactoringRequest.fnToRefactor,
      refactorResponse: resolvedResponse,
    });

    return codeLens;
  }

  update() {
    this.onDidChangeCodeLensesEmitter.fire();
  }
}
