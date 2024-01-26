import * as vscode from 'vscode';
import { getConfiguration } from './configuration';
import { logOutputChannel, outputChannel } from './log';
import Reviewer from './review/reviewer';

/**
 * A CS CodeLens is a CodeLens that is associated with a Diagnostic.
 */
export class CsCodeLens extends vscode.CodeLens {
  readonly diagnostic: vscode.Diagnostic;

  constructor(range: vscode.Range, diagnostic: vscode.Diagnostic, command?: vscode.Command) {
    super(range, command);
    this.diagnostic = diagnostic;
  }
}

export class CsCodeLensProvider implements vscode.CodeLensProvider<CsCodeLens> {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  constructor() {
    outputChannel.appendLine('Creating CodeLens provider');
  }

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
    logOutputChannel.debug('Providing CodeLenses for ' + document.fileName);

    // Return empty set if code lenses are disabled.
    if (!getConfiguration('enableCodeLenses')) {
      return [];
    }

    const diagnostics = await Reviewer.instance.review(document);

    if (!diagnostics || diagnostics.length === 0) {
      logOutputChannel.debug('No diagnostics for ' + document.fileName);
      return [];
    }

    const lenses = [];
    for (const diagnostic of diagnostics) {
      const range = diagnostic.range;
      const lens = new CsCodeLens(range, diagnostic);
      lenses.push(lens);
    }

    return lenses;
  }

  resolveCodeLens?(codeLens: CsCodeLens, token: vscode.CancellationToken): vscode.ProviderResult<CsCodeLens> {
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
