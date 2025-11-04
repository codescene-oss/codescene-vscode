import * as path from 'path';
import vscode, { Uri } from 'vscode';
import { logOutputChannel } from '../log';
import { CsReview } from './cs-review';
import { ReviewCacheItem } from './review-cache-item';

export class ReviewCache {
  private _cache = new Map<string, ReviewCacheItem>();

  constructor(private getBaselineCommit: (fileUri: Uri) => Promise<string | undefined>) {}

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
    this._cache.forEach((item) => {
      void item.runDeltaAnalysis();
    });
  }

  /**
   * Get review cache item. (note that fileName is same as uri.fsPath)
   */
  get(document: vscode.TextDocument): ReviewCacheItem | undefined {
    return this._cache.get(document.fileName);
  }

  async add(document: vscode.TextDocument, review: CsReview) {
    const item = new ReviewCacheItem(document, review);
    this._cache.set(document.fileName, item);
    logOutputChannel.trace(`ReviewCache.add: ${path.basename(document.fileName)}`);
    const baselineCommit = await this.getBaselineCommit(document.uri);
    if (baselineCommit) {
      item.setBaseline(baselineCommit);
    }
  }

  update(document: vscode.TextDocument, review: CsReview) {
    const reviewItem = this.get(document);
    if (!reviewItem) return false;

    logOutputChannel.trace(`ReviewCache.update: ${path.basename(document.fileName)}`);
    reviewItem.setReview(document, review);
    void reviewItem.runDeltaAnalysis();
    return true;
  }

  delete(fsPath: string) {
    const item = this._cache.get(fsPath);
    if (item) {
      void item.deleteDelta();
      this._cache.delete(fsPath);
    }
  }

  clear() {
    this._cache.clear();
  }

  setBaseline(fileFilter: (fileUri: Uri) => boolean) {
    this._cache.forEach(async (item) => {
      if (fileFilter(item.document.uri)) {
        const baselineCommit = await this.getBaselineCommit(item.document.uri);
        if (baselineCommit) {
          void item.setBaseline(baselineCommit);
        }
      }
    });
  }
}
