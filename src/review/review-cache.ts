import * as path from 'path';
import vscode, { Uri } from 'vscode';
import { logOutputChannel } from '../log';
import { CsReview } from './cs-review';
import { ReviewCacheItem } from './review-cache-item';

interface CacheEntry {
  item: ReviewCacheItem;
  skipMonitorUpdate: boolean;
}

export class ReviewCache {
  // filename -> CodeHealthRulesSnapshot (Map) -> CacheEntry
  private _cache = new Map<string, Map<Map<string, number>, CacheEntry>>();

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
      innerMap.forEach(async (entry, snapshot) => {
        try {
          await vscode.workspace.fs.stat(entry.item.document.uri);
          void entry.item.runDeltaAnalysis({ skipMonitorUpdate: entry.skipMonitorUpdate });
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
    for (const [snapshot, entry] of innerMap.entries()) {
      if (this.snapshotsEqual(snapshot, currentSnapshot)) {
        return entry.item;
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
      innerMap = new Map<Map<string, number>, CacheEntry>();
      this._cache.set(document.fileName, innerMap);
    }

    const snapshot = this.createCodeHealthRulesSnapshot();
    innerMap.set(snapshot, { item, skipMonitorUpdate });

    logOutputChannel.trace(`ReviewCache.add: ${path.basename(document.fileName)}`);
    const baselineCommit = await this.getBaselineCommit(document.uri);
    if (baselineCommit) {
      item.setBaseline(baselineCommit, skipMonitorUpdate, updateDiagnosticsPane);
    }
  }

  update(document: vscode.TextDocument, review: CsReview, skipMonitorUpdate: boolean, updateDiagnosticsPane: boolean) {
    const innerMap = this._cache.get(document.fileName);
    if (!innerMap) return false;

    const currentSnapshot = this.createCodeHealthRulesSnapshot();
    for (const [snapshot, entry] of innerMap.entries()) {
      if (this.snapshotsEqual(snapshot, currentSnapshot)) {
        logOutputChannel.trace(`ReviewCache.update: ${path.basename(document.fileName)}`);
        entry.item.setReview(document, review, skipMonitorUpdate);
        entry.skipMonitorUpdate = skipMonitorUpdate;
        void entry.item.runDeltaAnalysis({ skipMonitorUpdate });
        return true;
      }
    }
    return false;
  }

  delete(fsPath: string) {
    const innerMap = this._cache.get(fsPath);
    if (innerMap) {
      for (const entry of innerMap.values()) {
        void entry.item.deleteDelta(entry.skipMonitorUpdate);
      }
      this._cache.delete(fsPath);
    }
  }

  clear() {
    this._cache.clear();
  }

  setBaseline(fileFilter: (fileUri: Uri) => boolean) {
    this._cache.forEach((innerMap) => {
      innerMap.forEach(async (entry) => {
        if (fileFilter(entry.item.document.uri)) {
          const baselineCommit = await this.getBaselineCommit(entry.item.document.uri);
          if (baselineCommit) {
            void entry.item.setBaseline(baselineCommit, false, false);
          }
        }
      });
    });
  }
}
