import * as vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { logOutputChannel, outputChannel } from '../log';
import Reviewer from './reviewer';
import { isDefined, keyStr } from '../utils';

/**
 * A CS CodeLens is a CodeLens that is associated with a Diagnostic.
 */
export class CsReviewCodeLens extends vscode.CodeLens {
  readonly diagnostic: vscode.Diagnostic;

  constructor(range: vscode.Range, diagnostic: vscode.Diagnostic, command?: vscode.Command) {
    super(range, command);
    this.diagnostic = diagnostic;
  }
}

export class CsReviewCodeLensProvider implements vscode.CodeLensProvider<CsReviewCodeLens> {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  constructor() {
    outputChannel.appendLine('Creating Review CodeLens provider');
  }

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
    // Return empty set if code lenses are disabled.
    if (!getConfiguration('enableCodeLenses') || !isDefined(Reviewer.instance)) {
      return [];
    }

    const diagnostics = await Reviewer.instance.review(document);

    if (!diagnostics || diagnostics.length === 0) {
      logOutputChannel.debug('No diagnostics for ' + document.fileName);
      return [];
    }

    return diagnostics.map((d)=> new CsReviewCodeLens(d.range, d));
  }

  resolveCodeLens?(codeLens: CsReviewCodeLens, token: vscode.CancellationToken): vscode.ProviderResult<CsReviewCodeLens> {
    logOutputChannel.debug('Resolving Review CodeLenses for ' + keyStr(codeLens.diagnostic));

    codeLens.command = {
      title: codeLens.diagnostic.message,
      command: 'codescene.openDocsForDiagnostic',
      arguments: [codeLens.diagnostic],
    };

    return codeLens;
  }

  update() {
    this.onDidChangeCodeLensesEmitter.fire();
  }
}
