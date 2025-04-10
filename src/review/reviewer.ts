import { dirname } from 'path';
import vscode, { Disposable } from 'vscode';
import { getConfiguration } from '../configuration';
import { AbortError, DevtoolsAPI } from '../devtools-api';
import { Delta } from '../devtools-api/delta-model';
import { Review } from '../devtools-api/review-model';
import { CsDiagnostic } from '../diagnostics/cs-diagnostics';
import { SimpleExecutor } from '../executor';
import { logOutputChannel } from '../log';
import { formatScore, reviewResultToDiagnostics } from './utils';

export default class Reviewer {
  private static _instance: CachingReviewer;

  static init(context: vscode.ExtensionContext): void {
    Reviewer._instance = new CachingReviewer();
    context.subscriptions.push(Reviewer._instance);
    logOutputChannel.info('Code reviewer initialized');
  }

  static get instance(): CachingReviewer {
    return Reviewer._instance;
  }
}

export interface ReviewOpts {
  [key: string]: string | boolean;
}

export class CsReview {
  readonly diagnostics: Promise<CsDiagnostic[]>;
  readonly score: Promise<number | undefined>;
  readonly rawScore: Promise<void | string>;
  constructor(readonly document: vscode.TextDocument, readonly reviewResult: Promise<void | Review>) {
    this.score = reviewResult.then((reviewResult) => reviewResult?.score);
    this.diagnostics = reviewResult.then((reviewResult) => {
      if (!reviewResult) {
        return [];
      }
      return reviewResultToDiagnostics(reviewResult, document);
    });
    this.rawScore = reviewResult.then((reviewResult) => reviewResult?.['raw-score']);
  }

  get scorePresentation() {
    return this.score.then((score) => formatScore(score));
  }
}

export class ReviewCacheItem {
  private baselineScore?: Promise<void | string>;
  public documentVersion: number;
  public delta?: Delta;

  constructor(public document: vscode.TextDocument, public review: CsReview) {
    this.documentVersion = document.version;
    this.resetBaseline();
  }

  setReview(document: vscode.TextDocument, review: CsReview) {
    this.review = review;
    this.documentVersion = document.version;
  }

  /**
   * Triggers a delta analysis using the raw scores. The analyser will trigger an event on completion
   */
  async runDeltaAnalysis() {
    const oldScore = await this.baselineScore;
    const newScore = await this.review.rawScore;
    this.delta = await DevtoolsAPI.delta(this.document, oldScore, newScore);
  }

  /**
   * Deletes the delta for this item, and makes sure that (empty) DeltaAnalysisEvents are triggered properly
   */
  async deleteDelta() {
    this.delta = await DevtoolsAPI.delta(this.document);
  }

  resetBaseline() {
    this.baselineScore = Reviewer.instance.baselineScore(this.document);
    void this.runDeltaAnalysis();
  }
}

/**
 * Cache for review results and subsequent analyses.
 */
class ReviewCache {
  private _cache = new Map<string, ReviewCacheItem>();

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

  add(document: vscode.TextDocument, review: CsReview) {
    this._cache.set(document.fileName, new ReviewCacheItem(document, review));
  }

  delete(fsPath: string) {
    const item = this._cache.get(fsPath);
    if (item) {
      void item.deleteDelta();
      this._cache.delete(fsPath);
    }
  }

  resetBaseline(fsPath: string) {
    this._cache.get(fsPath)?.resetBaseline();
  }
}

class CachingReviewer implements Disposable {
  private reviewer = new FilteringReviewer();

  private disposables: vscode.Disposable[] = [];
  readonly reviewCache = new ReviewCache();

  constructor() {
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
      if (reviewCacheItem) return reviewCacheItem.review;
    }

    const reviewPromise = this.reviewer
      .review(document, reviewOpts)
      .then((reviewResult) => {
        // Clear cache of void reviews (ignored files probably)
        if (!reviewResult) this.reviewCache.delete(document.uri.fsPath);
        return reviewResult;
      })
      .catch((e) => this.handleReviewError(e, document));

    const csReview = new CsReview(document, reviewPromise);

    this.setOrUpdate(document, csReview);

    return csReview;
  }

  refreshDeltas() {
    this.reviewCache.refreshDeltas();
  }

  refreshAllDeltasAndBaselines() {
    for (const [_, item] of this.reviewCache['_cache'].entries()) {
      item.resetBaseline();
    }
  }

  /**
   * Review a baseline score and return the raw score - to be used by the delta analysis
   * @param document
   * @returns
   */
  async baselineScore(document: vscode.TextDocument) {
    return this.reviewer
      .review(document, { baseline: true })
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
  setOrUpdate(document: vscode.TextDocument, review: CsReview) {
    const reviewItem = this.reviewCache.get(document);
    if (reviewItem) {
      reviewItem.setReview(document, review);
      void reviewItem.runDeltaAnalysis();
    } else {
      this.reviewCache.add(document, review);
    }
  }

  abort(document: vscode.TextDocument): void {
    this.reviewer.abort(document);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

/**
 * A reviewer that respects .gitignore settings.
 *
 * If git is not installed, or if the current document is not part of workspace
 * (i.e. it's opened as a standalone file), then this reviewer will basically be
 * downgraded to the injected reviewer (which for normal use is the CachingReviewer)
 */
class FilteringReviewer {
  private gitExecutor: SimpleExecutor | null = null;
  private gitExecutorCache = new Map<string, boolean>();

  constructor() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      this.gitExecutor = new SimpleExecutor();
      const watcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
      watcher.onDidChange(() => this.clearCache());
      watcher.onDidCreate(() => this.clearCache());
      watcher.onDidDelete(() => this.clearCache());
    }
  }

  private clearCache() {
    this.gitExecutorCache = new Map<string, boolean>();
  }

  private async isIgnored(document: vscode.TextDocument) {
    const gitignore = getConfiguration('gitignore');

    if (!gitignore) return false;
    if (!this.gitExecutor) return false;

    const filePath = document.uri.fsPath;

    if (this.gitExecutorCache.has(filePath)) {
      return this.gitExecutorCache.get(filePath);
    }

    const result = await this.gitExecutor.execute(
      { command: 'git', args: ['check-ignore', filePath], ignoreError: true },
      { cwd: dirname(document.uri.fsPath) }
    );

    const ignored = result.exitCode === 0;

    this.gitExecutorCache.set(filePath, ignored);

    return ignored;
  }

  async review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<Review | void> {
    const ignored = await this.isIgnored(document);

    if (ignored) {
      return;
    }

    if (reviewOpts.baseline) {
      return DevtoolsAPI.reviewBaseline(document);
    } else {
      return DevtoolsAPI.reviewContent(document);
    }
  }

  abort(document: vscode.TextDocument): void {
    DevtoolsAPI.abortReviews(document);
  }
}
