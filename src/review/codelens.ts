import * as vscode from 'vscode';
import { getConfiguration, onDidChangeConfiguration } from '../configuration';
import { InteractiveDocsParams } from '../documentation/csdoc-provider';
import { logOutputChannel, outputChannel } from '../log';
import { isDefined, rangeStr } from '../utils';
import Reviewer from './reviewer';
import { getCsDiagnosticCode, isGeneralDiagnostic, removeDetails, roundScore } from './utils';

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

export class CsReviewCodeLensProvider implements vscode.CodeLensProvider<vscode.CodeLens>, vscode.Disposable {
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
    // Return early if code lenses are disabled or reviewer uninitialized.
    if (!isDefined(Reviewer.instance)) return;

    const cacheItem = Reviewer.instance.reviewCache.get(document);
    if (!cacheItem) return;

    const delta = cacheItem.delta;

    const codeLens = new vscode.CodeLens(new vscode.Range(0, 0, 0, 0));
    if (isDefined(delta)) {
      const oldScore = delta['old-score'] ? roundScore(delta['old-score']) : 'n/a';
      const newScore = roundScore(delta['new-score']);
      codeLens.command = {
        title: `$(pulse) Code Health: ${oldScore} → ${newScore}`,
        command: 'codescene.codeHealthMonitorView.focus',
      };
      return [codeLens];
    } else {
      return cacheItem.review.scorePresentation.then((scorePresentation) => {
        codeLens.command = {
          title: `$(pulse) Code Health: ${scorePresentation}`,
          command: 'markdown.showPreviewToSide',
          arguments: [vscode.Uri.parse('csdoc:general-code-health.md')],
        };
        return [codeLens];
      });
    }
  }
}
