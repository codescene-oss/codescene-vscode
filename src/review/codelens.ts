import * as vscode from 'vscode';
import { scorePresentation } from '../code-health-monitor/presentation';
import { onDidChangeConfiguration, reviewCodeLensesEnabled } from '../configuration';
import { DevtoolsAPI } from '../devtools-api';
import { FnToRefactor } from '../devtools-api/refactor-models';
import { CsDiagnostic } from '../diagnostics/cs-diagnostic';
import { toDocsParamsRanged } from '../documentation/commands';
import { isDefined } from '../utils';
import Reviewer from './reviewer';
import { ReviewCacheItem } from './review-cache-item';
import { CsCodeLens } from './cs-code-lens';

export class CsReviewCodeLensProvider
  implements vscode.CodeLensProvider<vscode.CodeLens | CsCodeLens>, vscode.Disposable
{
  private changeCodeLensesEmitter = new vscode.EventEmitter<void>();
  onDidChangeCodeLenses = this.changeCodeLensesEmitter.event;

  private disposables: vscode.Disposable[] = [];

  // We cache commands to avoid VS Code's CommandsConverter cache disposal issues (CS-5276).
  // Internally, VS Code caches commands with arguments and disposes them when providers refresh,
  // causing "Actual command not found" errors.
  // We register unique commands WITHOUT arguments per CodeLens location, which bypasses this caching mechanism.
  // See in https://github.com/microsoft/vscode/blob/d22e62803f7850381179d5113347954f29965c54/src/vs/workbench/api/common/extHostCommands.ts#L394
  // how caching only happens if we pass `arguments` around.
  private commandCache = new Map<
    string,
    {
      category: string;
      document: vscode.TextDocument;
      position: vscode.Position;
      fnToRefactor: FnToRefactor | undefined; // can be null
      commandId: string;
    }
  >();
  private commandDisposables = new Map<string, vscode.Disposable>();

  constructor() {
    this.disposables.push(
      onDidChangeConfiguration('enableReviewCodeLenses', () => this.changeCodeLensesEmitter.fire()),
      DevtoolsAPI.onDidReviewComplete(() => this.changeCodeLensesEmitter.fire()),
      DevtoolsAPI.onDidDeltaAnalysisComplete(() => this.changeCodeLensesEmitter.fire()),
      vscode.workspace.onDidCloseTextDocument((document) => {
        const docUri = document.uri.toString();
        const keysToDelete: string[] = [];

        for (const [key, cached] of this.commandCache.entries()) {
          if (cached.document.uri.toString() === docUri) {
            keysToDelete.push(key);
          }
        }

        keysToDelete.forEach((key) => {
          this.commandDisposables.get(key)?.dispose();
          this.commandDisposables.delete(key);
          this.commandCache.delete(key);
        });
      })
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.commandCache.clear();
    this.commandDisposables.forEach((d) => d.dispose());
    this.commandDisposables.clear();
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
        command: 'codescene.homeView.focus',
      };
      return codeLens;
    } else {
      const scorePresentation = await cacheItem.review.scorePresentation;
      codeLens.command = this.showCodeHealthDocsCommand(`Code Health: ${scorePresentation}`, cacheItem.document);
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
      .map((diagnostic: CsDiagnostic) => {
        if (diagnostic.codeSmell) {
          const cacheKey = `${document.uri.toString()}:${diagnostic.range.start.line}:${
            diagnostic.range.start.character
          }:${diagnostic.codeSmell.category}`;
          return new CsCodeLens(diagnostic.range, document, diagnostic.codeSmell, cacheKey);
        }
      })
      .filter(isDefined);
  }

  private async openInteractiveDocsCommand(codeLens: CsCodeLens, document: vscode.TextDocument) {
    const { codeSmell, range, cacheKey } = codeLens;
    const fnToRefactor = await DevtoolsAPI.fnsToRefactorFromCodeSmell(document, codeSmell);

    let cached = this.commandCache.get(cacheKey);

    if (!cached) {
      // Register a unique command withhout arguments to avoid VS Code's CommandsConverter cache, as mentioned above.
      const commandId = `codescene.openInteractiveDocs.${cacheKey.replace(/[^a-zA-Z0-9]/g, '_')}`;

      const command = vscode.commands.registerCommand(commandId, () => {
        const currentCached = this.commandCache.get(cacheKey);
        if (currentCached) {
          const params = toDocsParamsRanged(
            currentCached.category,
            currentCached.document,
            codeSmell,
            currentCached.fnToRefactor
          );
          void vscode.commands.executeCommand('codescene.openInteractiveDocsPanel', params, 'codelens (review)');
        }
      });

      this.commandDisposables.set(cacheKey, command);

      cached = {
        category: codeSmell.category,
        document,
        position: range.start,
        fnToRefactor,
        commandId,
      };
      this.commandCache.set(cacheKey, cached);
    } else {
      // Update the cached data with current values - especially for fnToRefactor which can change:
      cached.category = codeSmell.category;
      cached.document = document;
      cached.position = range.start;
      cached.fnToRefactor = fnToRefactor;
    }

    const title = `$(warning) ${codeSmell.category}`;
    return {
      title,
      command: cached.commandId,
    };
  }

  private showCodeHealthDocsCommand(message: string, document: vscode.TextDocument) {
    return {
      title: `$(pulse) ${message}`,
      command: 'codescene.openCodeHealthDocs',
      arguments: [document],
    };
  }
}
