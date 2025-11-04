import vscode, { Disposable, Uri } from 'vscode';
import { AbortError } from '../devtools-api/abort-error';
import { logOutputChannel } from '../log';
import { CsReview } from './cs-review';
import { FilteringReviewer } from './filtering-reviewer';
import { ReviewCache } from './review-cache';
import { ReviewOpts } from './reviewer';

export class CachingReviewer implements Disposable {
  private reviewer = new FilteringReviewer();

  private disposables: vscode.Disposable[] = [];
  readonly reviewCache: ReviewCache;

  constructor(getBaselineCommit: (fileUri: Uri) => Promise<string | undefined>) {
    this.reviewCache = new ReviewCache(getBaselineCommit);
    const deleteFileWatcher = vscode.workspace.createFileSystemWatcher('**/*', true, true, false);
    this.disposables.push(
      deleteFileWatcher,
      deleteFileWatcher.onDidDelete((uri) => {
        this.reviewCache.delete(uri.fsPath);
      })
    );
  }

  private handleReviewError(e: Error, document: vscode.TextDocument) {
    if (e instanceof AbortError) {
      // Delete the cache entry for this document if the review was aborted (document closed)
      // Otherwise it won't be reviewed immediately when the document is opened again
      this.reviewCache.delete(document.uri.fsPath);
    } else {
      logOutputChannel.error(e.message);
    }
  }

  review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): CsReview {
    if (!reviewOpts.skipCache) {
      // If we have a cached CsReview for this document/version combination, return it.
      const reviewCacheItem = this.reviewCache.getExactVersion(document);
      if (reviewCacheItem) {
        return reviewCacheItem.review;
      }
    }

    const reviewPromise = this.reviewer
      .review(document, reviewOpts)
      .then((reviewResult) => {
        // Clear cache of void reviews (ignored files probably)
        if (!reviewResult) {
          this.reviewCache.delete(document.uri.fsPath);
        }
        return reviewResult;
      })
      .catch((e) => this.handleReviewError(e, document));

    const csReview = new CsReview(document, reviewPromise);

    this.updateOrAdd(document, csReview);

    return csReview;
  }

  refreshDeltas() {
    this.reviewCache.refreshDeltas();
  }

  setBaseline(fileFilter: (fileUri: Uri) => boolean) {
    this.reviewCache.setBaseline(fileFilter);
  }

  /**
   * Review a baseline score and return the raw score - to be used by the delta analysis
   * @param document
   * @returns
   */
  async baselineScore(baselineCommit: string, document: vscode.TextDocument) {
    return this.reviewer
      .review(document, { baseline: baselineCommit })
      .then((reviewResult) => {
        return reviewResult && reviewResult['raw-score'];
      })
      .catch((e) => this.handleReviewError(e, document));
  }

  /**
   * Store the diagnostics promise in the cache, or update it with the
   * @param document
   * @param review
   */
  updateOrAdd(document: vscode.TextDocument, review: CsReview) {
    if (!this.reviewCache.update(document, review)) {
      void this.reviewCache.add(document, review);
    }
  }

  abort(document: vscode.TextDocument): void {
    this.reviewCache.delete(document.uri.fsPath);
    this.reviewer.abort(document);
  }

  clearCache() {
    this.reviewCache.clear();
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
