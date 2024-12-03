import * as vscode from 'vscode';
import { AnalysisEvent } from '../analysis-common';
import { DeltaAnalyser } from '../code-health-monitor/analyser';
import { scorePresentation } from '../code-health-monitor/model';
import { onDidChangeConfiguration, reviewCodeLensesEnabled } from '../configuration';
import { toDocsParams } from '../documentation/commands';
import { logOutputChannel } from '../log';
import { isDefined } from '../utils';
import Reviewer, { ReviewCacheItem } from './reviewer';
import { getCsDiagnosticCode, isGeneralDiagnostic, removeDetails } from './utils';
import { CsExtensionState } from '../cs-extension-state';

class CsCodeLens extends vscode.CodeLens {
  constructor(
    range: vscode.Range,
    public readonly document: vscode.TextDocument,
    public readonly diagnostic: vscode.Diagnostic
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
    const updateOnAnalysisEnd = (event: AnalysisEvent) => {
      if (event.type === 'end') {
        this.changeCodeLensesEmitter.fire();
      }
    };
    this.disposables.push(
      onDidChangeConfiguration('enableReviewCodeLenses', () => this.changeCodeLensesEmitter.fire()),
      Reviewer.instance.onDidReview(updateOnAnalysisEnd),
      DeltaAnalyser.instance.onDidAnalyse(updateOnAnalysisEnd)
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
      codeLens.command = await this.openInteractiveDocsCommand(codeLens.diagnostic, codeLens.document);
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
        if (!isGeneralDiagnostic(diagnostic)) {
          return new CsCodeLens(diagnostic.range, document, diagnostic);
        }
      })
      .filter(isDefined);
  }

  private async openInteractiveDocsCommand(diagnostic: vscode.Diagnostic, document: vscode.TextDocument) {
    const category = getCsDiagnosticCode(diagnostic.code);
    if (!category) {
      logOutputChannel.warn(`Unknown diagnostic code "${diagnostic.code}"`);
      return;
    }

    const fnToRefactor = (
      await CsExtensionState.aceCapabilities?.getFunctionsToRefactor(document, [
        { category, line: diagnostic.range.start.line + 1 },
      ])
    )?.[0];

    const title = `$(warning) ${removeDetails(diagnostic.message)}`;
    return {
      title,
      command: 'codescene.openInteractiveDocsPanel',
      arguments: [toDocsParams(category, diagnostic.range.start, document, fnToRefactor), 'codelens (review)'],
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
