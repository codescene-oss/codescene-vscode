import * as vscode from 'vscode';
import { scorePresentation } from '../code-health-monitor/presentation';
import { onDidChangeConfiguration, reviewCodeLensesEnabled } from '../configuration';
import { DevtoolsAPI } from '../devtools-api';
import { CodeSmell } from '../devtools-api/review-model';
import { toDocsParams } from '../documentation/commands';
import { isDefined } from '../utils';
import Reviewer, { ReviewCacheItem } from './reviewer';

class CsCodeLens extends vscode.CodeLens {
  constructor(
    range: vscode.Range,
    public readonly document: vscode.TextDocument,
    public readonly codeSmell: CodeSmell
  ) {
    super(range);
  }
}

export class CsReviewCodeLensProvider
  implements vscode.CodeLensProvider<vscode.CodeLens | CsCodeLens>, vscode.Disposable
{
  private changeCodeLensesEmitter = new vscode.EventEmitter<void>();
  onDidChangeCodeLenses = this.changeCodeLensesEmitter.event;

  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      onDidChangeConfiguration('enableReviewCodeLenses', () => this.changeCodeLensesEmitter.fire()),
      DevtoolsAPI.onDidReviewComplete(() => this.changeCodeLensesEmitter.fire()),
      DevtoolsAPI.onDidDeltaAnalysisComplete(() => this.changeCodeLensesEmitter.fire())
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
    const cacheItem = Reviewer.instance.reviewCache.get(document);
    if (!cacheItem) return;

    const scoreLens = this.provideScoreLens(cacheItem);
    const diagnosticsLenses = this.provideDiagnosticsLenses(cacheItem, document);
    return Promise.all([scoreLens, diagnosticsLenses]).then(([scoreLens, diagnosticsLenses]) => {
      return [scoreLens, ...diagnosticsLenses];
    });
  }

  async resolveCodeLens(codeLens: vscode.CodeLens | CsCodeLens, token: vscode.CancellationToken) {
    if (codeLens instanceof CsCodeLens) {
      codeLens.command = await this.openInteractiveDocsCommand(codeLens, codeLens.document);
    }
    return codeLens;
  }

  private async provideScoreLens(cacheItem: ReviewCacheItem) {
    const delta = cacheItem.delta;

    const codeLens = new vscode.CodeLens(new vscode.Range(0, 0, 0, 0));
    if (isDefined(delta)) {
      codeLens.command = {
        title: `$(pulse) Code Health: ${scorePresentation(delta)}`,
        command: 'codescene.codeHealthMonitorView.focus',
      };
      return codeLens;
    } else {
      const scorePresentation = await cacheItem.review.scorePresentation;
      codeLens.command = this.showCodeHealthDocsCommand(`Code Health: ${scorePresentation}`);
      return codeLens;
    }
  }

  private async provideDiagnosticsLenses(cacheItem: ReviewCacheItem, document: vscode.TextDocument) {
    if (!reviewCodeLensesEnabled()) {
      return [];
    }
    const diagnostics = await cacheItem.review.diagnostics;

    if (!diagnostics || diagnostics.length === 0) {
      return [];
    }

    return diagnostics
      .map((diagnostic) => {
        if (diagnostic.codeSmell) {
          return new CsCodeLens(diagnostic.range, document, diagnostic.codeSmell);
        }
      })
      .filter(isDefined);
  }

  private async openInteractiveDocsCommand(codeLens: CsCodeLens, document: vscode.TextDocument) {
    const { codeSmell, range } = codeLens;
    const fnToRefactor = await DevtoolsAPI.fnsToRefactorFromCodeSmell(document, codeSmell);

    const title = `$(warning) ${codeSmell.category}`;
    return {
      title,
      command: 'codescene.openInteractiveDocsPanel',
      arguments: [toDocsParams(codeSmell.category, document, range.start, fnToRefactor), 'codelens (review)'],
    };
  }

  private showCodeHealthDocsCommand(message: string) {
    return {
      title: `$(pulse) ${message}`,
      command: 'markdown.showPreviewToSide',
      arguments: [vscode.Uri.parse('csdoc:general-code-health.md')],
    };
  }
}
