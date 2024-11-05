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

export class CsReviewCodeLensProvider implements vscode.CodeLensProvider<vscode.CodeLens>, vscode.Disposable {
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
    const diagnosticsLenses = this.provideDiagnosticsLenses(cacheItem);
    return Promise.all([scoreLens, diagnosticsLenses]).then(([scoreLens, diagnosticsLenses]) => {
      return [scoreLens, ...diagnosticsLenses];
    });
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

  private async provideDiagnosticsLenses(cacheItem: ReviewCacheItem) {
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
          return new vscode.CodeLens(
            diagnostic.range,
            this.openInteractiveDocsCommand(diagnostic, cacheItem.review.document.uri)
          );
        }
      })
      .filter(isDefined);
  }

  private openInteractiveDocsCommand(diagnostic: vscode.Diagnostic, documentUri: vscode.Uri) {
    const category = getCsDiagnosticCode(diagnostic.code);
    if (!category) {
      logOutputChannel.warn(`Unknown diagnostic code "${diagnostic.code}"`);
      return;
    }
    const title = `$(warning) ${removeDetails(diagnostic.message)}`;
    return {
      title,
      command: 'codescene.openInteractiveDocsPanel',
      arguments: [toDocsParams(category, diagnostic.range.start, documentUri)],
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
