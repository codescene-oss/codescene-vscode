import * as path from 'path';
import vscode from 'vscode';
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
  getExactVersion(document: vscode.TextDocument, skipMonitorUpdate: boolean | "any"): ReviewCacheItem | undefined {
    // If we have a cached promise for this document, return it.
    const reviewItem = this.get(document, skipMonitorUpdate);
    if (reviewItem && reviewItem.documentVersion === document.version) {
      return reviewItem;
    }
  }

  /**
   * Drops cache entries whose file no longer exists on disk.
   */
  pruneDeletedFiles() {
    this._cache.forEach((innerMap, fileName) => {
      innerMap.forEach(async (entry, snapshot) => {
        try {
          await vscode.workspace.fs.stat(entry.item.document.uri);
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
  get(document: vscode.TextDocument, skipMonitorUpdate: boolean | "any"): ReviewCacheItem | undefined {
    const innerMap = this._cache.get(document.fileName);
    if (!innerMap) return undefined;

    const currentSnapshot = this.createCodeHealthRulesSnapshot();
    for (const [snapshot, entry] of innerMap.entries()) {
      const skipMonitorMatches = skipMonitorUpdate === "any" || skipMonitorUpdate === entry.skipMonitorUpdate;
      if (this.snapshotsEqual(snapshot, currentSnapshot) && skipMonitorMatches) {
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

  private resolveSkipMonitorUpdate(newValue: boolean, cachedValue: boolean): boolean {
    return cachedValue === false ? false : newValue;
  }

  add(document: vscode.TextDocument, review: CsReview, skipMonitorUpdate: boolean) {
    const item = new ReviewCacheItem(document, review);

    let innerMap = this._cache.get(document.fileName);
    if (!innerMap) {
      innerMap = new Map<Map<string, number>, CacheEntry>();
      this._cache.set(document.fileName, innerMap);
    }

    const snapshot = this.createCodeHealthRulesSnapshot();

    let finalSkipMonitorUpdate = skipMonitorUpdate;
    let existingSnapshotKey: Map<string, number> | undefined;
    for (const [existingSnapshot, existingEntry] of innerMap.entries()) {
      if (this.snapshotsEqual(existingSnapshot, snapshot)) {
        finalSkipMonitorUpdate = this.resolveSkipMonitorUpdate(skipMonitorUpdate, existingEntry.skipMonitorUpdate);
        existingSnapshotKey = existingSnapshot;
        break;
      }
    }

    // Delete old snapshot key if it exists (since Map uses object identity)
    if (existingSnapshotKey) {
      innerMap.delete(existingSnapshotKey);
    }

    innerMap.set(snapshot, { item, skipMonitorUpdate: finalSkipMonitorUpdate });

    logOutputChannel.trace(`ReviewCache.add: ${path.basename(document.fileName)}`);
  }

  update(document: vscode.TextDocument, review: CsReview, skipMonitorUpdate: boolean) {
    const innerMap = this._cache.get(document.fileName);
    if (!innerMap) return false;

    const currentSnapshot = this.createCodeHealthRulesSnapshot();
    for (const [snapshot, entry] of innerMap.entries()) {
      if (this.snapshotsEqual(snapshot, currentSnapshot)) {
        logOutputChannel.trace(`ReviewCache.update: ${path.basename(document.fileName)}`);

        entry.item.setReview(document, review);
        entry.skipMonitorUpdate = this.resolveSkipMonitorUpdate(skipMonitorUpdate, entry.skipMonitorUpdate);
        return true;
      }
    }
    return false;
  }

  delete(fsPath: string) {
    this._cache.delete(fsPath);
  }

  clear() {
    this._cache.clear();
  }
}
