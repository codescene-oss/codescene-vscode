import * as vscode from 'vscode';
import { getConfiguration, onDidChangeConfiguration } from '../configuration';
import { InteractiveDocsParams } from '../documentation/csdoc-provider';
import { logOutputChannel, outputChannel } from '../log';
import { isDefined, rangeStr } from '../utils';
import Reviewer from './reviewer';
import { chScorePrefix, getCsDiagnosticCode } from './utils';

/**
 * A CS CodeLens is a CodeLens that is associated with a Diagnostic.
 */
export class CsReviewCodeLens extends vscode.CodeLens {
  constructor(
    range: vscode.Range,
    readonly diagnostic: vscode.Diagnostic,
    readonly document: vscode.TextDocument,
    command?: vscode.Command
  ) {
    super(range, command);
  }
}

export class CsReviewCodeLensProvider implements vscode.CodeLensProvider<CsReviewCodeLens>, vscode.Disposable {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  private disposables: vscode.Disposable[] = [];

  constructor() {
    outputChannel.appendLine('Creating Review CodeLens provider');
    this.disposables.push(onDidChangeConfiguration('enableCodeLenses', () => this.onDidChangeCodeLensesEmitter.fire()));
    this.disposables.push(
      Reviewer.instance.onDidReview((event) => {
        if (event.type === 'end') {
          this.onDidChangeCodeLensesEmitter.fire();
        }
      })
    );
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

    const cacheItem = Reviewer.instance.reviewCache.get(document.fileName);
    const diagnostics = cacheItem && (await cacheItem.csReview.diagnostics);

    if (!diagnostics || diagnostics.length === 0) {
      return [];
    }

    return diagnostics.map((d) => new CsReviewCodeLens(d.range, d, document));
  }

  resolveCodeLens?(
    codeLens: CsReviewCodeLens,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<CsReviewCodeLens> {
    const diagnostic = codeLens.diagnostic;
    logOutputChannel.trace(`Resolving Review CodeLenses for ${diagnostic.message} ${rangeStr(diagnostic.range)}`);

    if (diagnostic.message.startsWith(chScorePrefix)) {
      codeLens.command = this.showCodeHealthDocsCommand(diagnostic.message);
    } else {
      codeLens.command = this.openInteractiveDocsCommand(diagnostic, codeLens.document.uri);
    }
    return codeLens;
  }

  private openInteractiveDocsCommand(diagnostic: vscode.Diagnostic, documentUri: vscode.Uri) {
    const category = getCsDiagnosticCode(diagnostic.code);
    if (!category) {
      logOutputChannel.warn(`Unknown diagnostic code "${diagnostic.code}"`);
      return;
    }
    const params: InteractiveDocsParams = {
      codeSmell: {
        category,
        position: diagnostic.range.start,
      },
      documentUri,
    };
    return {
      title: diagnostic.message,
      command: 'codescene.openInteractiveDocsPanel',
      arguments: [params],
    };
  }

  private showCodeHealthDocsCommand(message: string) {
    return {
      title: message,
      command: 'markdown.showPreviewToSide',
      arguments: [vscode.Uri.parse('csdoc:general-code-health.md')],
    };
  }
}
