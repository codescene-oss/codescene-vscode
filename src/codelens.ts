import * as vscode from 'vscode';
import { check } from './codescene-interop';

export async function codeLensClickedHandler(diagnostic: vscode.Diagnostic) {
  const diagnosticDocs = `What does "${diagnostic.message}" mean?`;
  const codeHealthDocs = 'Open general code health documentation';

  let options = [];
  if (diagnostic.code) {
    options.push(diagnosticDocs);
  }
  options.push(codeHealthDocs);

  const action = await vscode.window.showQuickPick(options);

  // We need to get separate docs for each diagnostic!
  if (action === diagnosticDocs) {
    vscode.commands.executeCommand('codescene.openDocsForDiagnostic', diagnostic);
  }

  if (action === codeHealthDocs) {
    vscode.commands.executeCommand('codescene.openCodeHealthDocs');
  }
}

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

  constructor(private cliPath: string) {
    console.log('CodeScene: creating CodeLens provider');
  }

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
    console.log('CodeScene: providing CodeLenses for ' + document.fileName);

    // Return empty set if code lenses are disabled.
    if (!vscode.workspace.getConfiguration('codescene').get('enableCodeLenses')) {
      return [];
    }

    const diagnostics = await check(this.cliPath, document);

    if (!diagnostics || diagnostics.length === 0) {
      console.log('CodeScene: no diagnostics for ' + document.fileName);
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
      command: 'codescene.actionPicker',
      arguments: [codeLens.diagnostic],
    };

    return codeLens;
  }

  update() {
    this.onDidChangeCodeLensesEmitter.fire();
  }
}
