import * as path from 'path';
import vscode, { Uri } from 'vscode';
import { logOutputChannel } from '../log';
import { CsReview } from './cs-review';
import { ReviewCacheItem } from './review-cache-item';

export class ReviewCache {
  // filename -> CodeHealthRulesSnapshot (Map) -> ReviewCacheItem
  private _cache = new Map<string, Map<Map<string, number>, ReviewCacheItem>>();

  constructor(
    private getBaselineCommit: (fileUri: Uri) => Promise<string | undefined>,
    private getCodeHealthFileVersions: () => Map<string, number>
  ) {}

  private createCodeHealthRulesSnapshot(): Map<string, number> {
    const versions = this.getCodeHealthFileVersions();
    const sorted = new Map(
      Array.from(versions.entries()).sort(([filenameA], [filenameB]) => filenameA.localeCompare(filenameB))
    );
    return sorted;
  }

  /**
   * Get the current review for this document given the document.version matches the review item version.
   */
  getExactVersion(document: vscode.TextDocument): ReviewCacheItem | undefined {
    // If we have a cached promise for this document, return it.
    const reviewItem = this.get(document);
    if (reviewItem && reviewItem.documentVersion === document.version) {
      return reviewItem;
    }
  }

  refreshDeltas() {
    this._cache.forEach((innerMap, fileName) => {
      innerMap.forEach(async (item, snapshot) => {
        try {
          await vscode.workspace.fs.stat(item.document.uri);
          void item.runDeltaAnalysis({ skipMonitorUpdate: false });
        } catch { // File doesn't exist
          innerMap.delete(snapshot);
          if (innerMap.size === 0) {
            this._cache.delete(fileName);
          }
        }
      });
    });
  }

  /**
   * Get review cache item. (note that fileName is same as uri.fsPath)
   */
  get(document: vscode.TextDocument): ReviewCacheItem | undefined {
    const innerMap = this._cache.get(document.fileName);
    if (!innerMap) return undefined;

    const currentSnapshot = this.createCodeHealthRulesSnapshot();
    for (const [snapshot, item] of innerMap.entries()) {
      if (this.snapshotsEqual(snapshot, currentSnapshot)) {
        return item;
      }
    }
    return undefined;
  }

  snapshotsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [filename, version] of a.entries()) {
      if (b.get(filename) !== version) {
        return false;
      }
    }
    return true;
  }

  async add(document: vscode.TextDocument, review: CsReview, skipMonitorUpdate: boolean, updateDiagnosticsPane: boolean) {
    const item = new ReviewCacheItem(document, review);

    let innerMap = this._cache.get(document.fileName);
    if (!innerMap) {
      innerMap = new Map<Map<string, number>, ReviewCacheItem>();
      this._cache.set(document.fileName, innerMap);
    }

    const snapshot = this.createCodeHealthRulesSnapshot();
    innerMap.set(snapshot, item);

    logOutputChannel.trace(`ReviewCache.add: ${path.basename(document.fileName)}`);
    const baselineCommit = await this.getBaselineCommit(document.uri);
    if (baselineCommit) {
      item.setBaseline(baselineCommit, skipMonitorUpdate, updateDiagnosticsPane);
    }
  }

  update(document: vscode.TextDocument, review: CsReview, skipMonitorUpdate: boolean, updateDiagnosticsPane: boolean) {
    const reviewItem = this.get(document);
    if (!reviewItem) return false;

    logOutputChannel.trace(`ReviewCache.update: ${path.basename(document.fileName)}`);
    reviewItem.setReview(document, review, skipMonitorUpdate);
    void reviewItem.runDeltaAnalysis({ skipMonitorUpdate });
    return true;
  }

  delete(fsPath: string) {
    const innerMap = this._cache.get(fsPath);
    if (innerMap) {
      for (const item of innerMap.values()) {
        void item.deleteDelta();
      }
      this._cache.delete(fsPath);
    }
  }

  clear() {
    this._cache.clear();
  }

  setBaseline(fileFilter: (fileUri: Uri) => boolean) {
    this._cache.forEach((innerMap) => {
      innerMap.forEach(async (item) => {
        if (fileFilter(item.document.uri)) {
          const baselineCommit = await this.getBaselineCommit(item.document.uri);
          if (baselineCommit) {
            void item.setBaseline(baselineCommit, false, false);
          }
        }
      });
    });
  }
}
