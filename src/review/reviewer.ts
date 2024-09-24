import { basename, dirname } from 'path';
import vscode from 'vscode';
import { AnalysisEvent } from '../analysis-common';
import { DeltaAnalyser } from '../code-health-monitor/analyser';
import { getConfiguration } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { LimitingExecutor, SimpleExecutor } from '../executor';
import { logOutputChannel, outputChannel } from '../log';
import { StatsCollector } from '../stats';
import { ReviewResult } from './model';
import { formatScore, reviewResultToDiagnostics } from './utils';
import { DeltaForFile } from '../code-health-monitor/model';
import { isDefined } from '../utils';

export type ReviewEvent = AnalysisEvent & { document?: vscode.TextDocument };

export default class Reviewer {
  private static _instance: CachingReviewer;

  static init(): void {
    outputChannel.appendLine('Initializing code Reviewer');
    Reviewer._instance = new CachingReviewer(new FilteringReviewer(new SimpleReviewer(CsExtensionState.cliPath)));
  }

  static get instance(): CachingReviewer {
    return Reviewer._instance;
  }
}

export interface ReviewOpts {
  [key: string]: string | boolean;
}

export class CsReview {
  readonly diagnostics: Promise<vscode.Diagnostic[]>;
  readonly score: Promise<void | number>;
  readonly rawScore: Promise<void | string>;
  constructor(readonly document: vscode.TextDocument, readonly reviewResult: Promise<void | ReviewResult>) {
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
  public delta?: DeltaForFile;

  constructor(private document: vscode.TextDocument, public review: CsReview) {
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
    const delta = await DeltaAnalyser.instance.deltaForScores(this.document, oldScore, newScore);
    if (delta) this.delta = delta;
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
  getExactVersion(document: vscode.TextDocument): CsReview | undefined {
    // If we have a cached promise for this document, return it.
    const reviewItem = this.get(document);
    if (reviewItem && reviewItem.documentVersion === document.version) {
      return reviewItem.review;
    }
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

  delete(document: vscode.TextDocument) {
    this._cache.delete(document.fileName);
  }

  resetBaseline(fsPath: string) {
    this._cache.get(fsPath)?.resetBaseline();
  }
}

class CachingReviewer {
  readonly reviewCache = new ReviewCache();

  private readonly errorEmitter = new vscode.EventEmitter<Error>();
  readonly onDidReviewFail = this.errorEmitter.event;
  private readonly reviewEmitter = new vscode.EventEmitter<ReviewEvent>();
  readonly onDidReview = this.reviewEmitter.event;

  private reviewsRunning = 0;

  constructor(private reviewer: InternalReviewer) {}

  private startReviewEvent(document: vscode.TextDocument) {
    this.reviewsRunning++;
    this.reviewEmitter.fire({ type: 'start', document });
  }

  private endReviewEvent(document: vscode.TextDocument) {
    this.reviewsRunning--;
    this.reviewEmitter.fire({ type: 'end', document });
    if (this.reviewsRunning === 0) {
      this.reviewEmitter.fire({ type: 'idle' });
    }
  }

  /**
   * ReviewErrors with exit !== 1 are reported separately (or not at all),
   * as they are not considered fatal.
   */
  private handleReviewError(e: Error, document: vscode.TextDocument) {
    if (e instanceof ReviewError) {
      switch (e.exitCode) {
        case 2:
          logOutputChannel.warn(e.message);
          void vscode.window.showWarningMessage(e.message);
          return;
        case 'ABORT_ERR':
          // Delete the cache entry for this document if the review was aborted (document closed)
          // Otherwise it won't be reviewed immediately when the document is opened again
          this.reviewCache.delete(document);
          return;
        default:
          logOutputChannel.error(e.message);
          this.errorEmitter.fire(e); // Fire errors for all other errors
          return;
      }
    }
  }

  review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): CsReview {
    if (!reviewOpts.skipCache) {
      // If we have a cached CsReview for this document/version combination, return it.
      const review = this.reviewCache.getExactVersion(document);
      if (review) return review;
    }

    this.startReviewEvent(document);
    const reviewPromise = this.reviewer
      .review(document, reviewOpts)
      .then((reviewResult) => {
        // Clear cache of void reviews (ignored files probably)
        if (!reviewResult) this.reviewCache.delete(document);
        return reviewResult;
      })
      .catch((e) => this.handleReviewError(e, document))
      .finally(() => {
        this.endReviewEvent(document);
      });

    const csReview = new CsReview(document, reviewPromise);

    this.setOrUpdate(document, csReview);

    return csReview;
  }

  /**
   * Review a baseline score and return the raw score - to be used by the delta analysis
   * @param document
   * @returns
   */
  async baselineScore(document: vscode.TextDocument) {
    this.startReviewEvent(document);
    return this.reviewer
      .review(document, { baseline: true })
      .then((reviewResult) => {
        return reviewResult && reviewResult['raw-score'];
      })
      .catch((e) => this.handleReviewError(e, document))
      .finally(() => {
        this.endReviewEvent(document);
      });
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
}

interface InternalReviewer {
  review(document: vscode.TextDocument, reviewOpts?: ReviewOpts): Promise<ReviewResult | void>;
  abort(document: vscode.TextDocument): void;
}

class ReviewError extends Error {
  constructor(public exitCode: number | string, public message: string) {
    super();
  }
}

function taskId(document: vscode.TextDocument) {
  return `${document.uri.fsPath} v${document.version}`;
}

class SimpleReviewer implements InternalReviewer {
  private readonly executor: LimitingExecutor = new LimitingExecutor();

  constructor(private cliPath: string) {}

  async review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<ReviewResult | void> {
    if (reviewOpts.baseline) {
      return this.baselineReview(document);
    } else {
      return this.contentReview(document);
    }
  }

  private async baselineReview(document: vscode.TextDocument): Promise<ReviewResult | void> {
    const { fileName, documentDirectory } = this.fileParts(document);
    const headPath = `HEAD:./${fileName}`;
    const { stdout, stderr, exitCode, duration } = await this.executor.execute(
      {
        command: this.cliPath,
        args: ['review', '--ide-api', headPath],
        taskId: taskId(document) + '-baseline',
        ignoreError: true,
      },
      { cwd: documentDirectory }
    );

    if (exitCode === 0 && stdout.trim() !== '') {
      logOutputChannel.trace(`Baseline review for ${headPath} succeeded`);
      StatsCollector.instance.recordAnalysis(document.fileName, duration);
      return JSON.parse(stdout) as ReviewResult;
    }
    // Just return void otherwise - this just means that we don't have any baseline to compare to
    logOutputChannel.trace(
      `Baseline review for ${headPath} failed: ${stderr.trim()} (exit ${exitCode}) - no baseline available`
    );
  }

  private async contentReview(document: vscode.TextDocument): Promise<ReviewResult> {
    const { fileName, documentDirectory } = this.fileParts(document);

    const { stdout, stderr, exitCode, duration } = await this.executor.execute(
      {
        command: this.cliPath,
        args: ['review', '--ide-api', '--file-name', fileName],
        taskId: taskId(document),
        ignoreError: true, // Set to true so executor won't reject promises. Handle exitCode/stderr below instead
      },
      { cwd: documentDirectory },
      document.getText()
    );

    if (exitCode !== 0) {
      throw new ReviewError(exitCode, `CodeScene review failed: '${stderr.trim()}' (exit ${exitCode})`);
    }

    StatsCollector.instance.recordAnalysis(document.fileName, duration);
    return JSON.parse(stdout) as ReviewResult;
  }

  private fileParts(document: vscode.TextDocument) {
    const fileName = basename(document.fileName);

    // Get the fsPath of the current document because we want to execute the
    // 'cs review' command in the same directory as the current document
    // (i.e. inside the repo to pick up on any .codescene/code-health-config.json file)
    const documentDirectory = dirname(document.fileName);
    return { fileName, documentDirectory };
  }

  abort(document: vscode.TextDocument): void {
    this.executor.abort(taskId(document));
  }
}

/**
 * A reviewer that respects .gitignore settings.
 *
 * If git is not installed, or if the current document is not part of workspace
 * (i.e. it's opened as a standalone file), then this reviewer will basically be
 * downgraded to the injected reviewer (which for normal use is the CachingReviewer)
 */
class FilteringReviewer implements InternalReviewer {
  private gitExecutor: SimpleExecutor | null = null;
  private gitExecutorCache = new Map<string, boolean>();

  constructor(private reviewer: InternalReviewer) {
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

  async review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<ReviewResult | void> {
    const ignored = await this.isIgnored(document);

    if (ignored) {
      return;
    }

    return this.reviewer.review(document, reviewOpts);
  }

  abort(document: vscode.TextDocument): void {
    this.reviewer.abort(document);
  }
}
