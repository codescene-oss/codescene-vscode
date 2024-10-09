import * as vscode from 'vscode';
import { scorePresentation } from '../code-health-monitor/model';
import { getConfiguration, onDidChangeConfiguration } from '../configuration';
import { toDocsParams } from '../documentation/csdoc-provider';
import { logOutputChannel } from '../log';
import { isDefined } from '../utils';
import Reviewer, { ReviewCacheItem } from './reviewer';
import { getCsDiagnosticCode, isGeneralDiagnostic, removeDetails } from './utils';

export class CsReviewCodeLensProvider implements vscode.CodeLensProvider<vscode.CodeLens>, vscode.Disposable {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  private disposables: vscode.Disposable[] = [];

  constructor() {
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

    if (getConfiguration('previewCodeHealthMonitoring')) {
      return this.codeHealthMonitorLenses(cacheItem);
    } else {
      return this.legacyCodeLenses(cacheItem);
    }
  }

  private async codeHealthMonitorLenses(cacheItem: ReviewCacheItem) {
    const delta = cacheItem.delta;

    const codeLens = new vscode.CodeLens(new vscode.Range(0, 0, 0, 0));
    if (isDefined(delta)) {
      codeLens.command = {
        title: `$(pulse) Code Health: ${scorePresentation(delta)}`,
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

  private async legacyCodeLenses(cacheItem: ReviewCacheItem) {
    if (!getConfiguration('enableCodeLenses')) {
      return [];
    }

    const diagnostics = await cacheItem.review.diagnostics;

    if (!diagnostics || diagnostics.length === 0) {
      return [];
    }

    return diagnostics.map((diagnostic) => {
      const codeLens = new vscode.CodeLens(diagnostic.range);
      if (isGeneralDiagnostic(diagnostic)) {
        codeLens.command = this.showCodeHealthDocsCommand(diagnostic.message);
      } else {
        codeLens.command = this.openInteractiveDocsCommand(diagnostic, cacheItem.review.document.uri);
      }
      return codeLens;
    });
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
