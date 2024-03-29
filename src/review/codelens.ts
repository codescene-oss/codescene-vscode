import * as vscode from 'vscode';
import { getConfiguration, onDidChangeConfiguration } from '../configuration';
import { logOutputChannel, outputChannel } from '../log';
import Reviewer from './reviewer';
import { isDefined, rangeStr } from '../utils';

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

export class CsReviewCodeLensProvider implements vscode.CodeLensProvider<CsReviewCodeLens>, vscode.Disposable {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  private disposables: vscode.Disposable[] = [];

  constructor() {
    outputChannel.appendLine('Creating Review CodeLens provider');
    this.disposables.push(onDidChangeConfiguration('enableCodeLenses', () => this.onDidChangeCodeLensesEmitter.fire()));
  }

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
    // Return empty set if code lenses are disabled.
    if (!getConfiguration('enableCodeLenses') || !isDefined(Reviewer.instance)) {
      return [];
    }

    const diagnostics = await Reviewer.instance.review(document);

    if (!diagnostics || diagnostics.length === 0) {
      return [];
    }

    return diagnostics.map((d) => new CsReviewCodeLens(d.range, d));
  }

  resolveCodeLens?(
    codeLens: CsReviewCodeLens,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<CsReviewCodeLens> {
    logOutputChannel.trace(
      `Resolving Review CodeLenses for ${codeLens.diagnostic.message} ${rangeStr(codeLens.diagnostic.range)}`
    );

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
