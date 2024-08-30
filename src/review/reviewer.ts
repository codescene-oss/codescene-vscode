import path, { dirname } from 'path';
import vscode from 'vscode';
import { AnalysisEvent } from '../analysis-common';
import { DeltaAnalyser } from '../code-health-monitor/analyser';
import { DeltaForFile } from '../code-health-monitor/model';
import { getConfiguration } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { LimitingExecutor, SimpleExecutor } from '../executor';
import { logOutputChannel, outputChannel } from '../log';
import { StatsCollector } from '../stats';
import { ReviewResult } from './model';
import { formatScore, reviewResultToDiagnostics } from './utils';

export type ReviewEvent = AnalysisEvent & { document?: vscode.TextDocument };

export default class Reviewer {
  private static _instance: CachingReviewer;

  static init(): void {
    outputChannel.appendLine('Initializing code Reviewer');
    Reviewer._instance = new CachingReviewer(new FilteringReviewer(new SimpleReviewer(CsExtensionState.cliPath)));

    vscode.commands.registerCommand('codescene.debugReviewCache', () => {
      Reviewer.instance.debugCache(vscode.window.activeTextEditor?.document);
    });
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
  readonly rawScore: Promise<void | any>;
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

class ReviewCacheItem {
  private baselineScore: any;
  public documentVersion: number;
  public delta?: DeltaForFile;

  constructor(private document: vscode.TextDocument, public review: CsReview) {
    this.documentVersion = document.version;
    void this.review.rawScore.then((score) => (this.baselineScore = score));
  }

  setReview(document: vscode.TextDocument, review: CsReview) {
    this.review = review;
    this.documentVersion = document.version;
  }

  /**
   * Runs the delta analysis using the raw scores, then sets the result if there were any.
   */
  async runDeltaAnalysis() {
    const oldScore = this.baselineScore;
    const newScore = await this.review.rawScore;
    return DeltaAnalyser.instance.deltaForScores(this.document, oldScore, newScore).then((delta) => {
      delta ? (this.delta = delta) : (this.delta = undefined);
    });
  }
}

/**
 * Cache for review results and subsequent analyses.
 */
class ReviewCache {
  readonly reviewCache = new Map<string, ReviewCacheItem>();

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
    return this.reviewCache.get(document.fileName);
  }

  set(document: vscode.TextDocument, review: CsReview) {
    this.reviewCache.set(document.fileName, new ReviewCacheItem(document, review));
  }

  delete(document: vscode.TextDocument) {
    this.reviewCache.delete(document.fileName);
  }
}

class CachingReviewer {
  readonly reviewCache = new ReviewCache();

  private readonly errorEmitter = new vscode.EventEmitter<Error>();
  readonly onDidReviewFail = this.errorEmitter.event;
  private readonly reviewEmitter = new vscode.EventEmitter<ReviewEvent>();
  readonly onDidReview = this.reviewEmitter.event;

  private readonly deltaEmitter = new vscode.EventEmitter<ReviewCacheItem>();
  /**
   * Emits events when a delta analysis has been completed. The emitted item
   * is the ReviewCacheItem that was analysed, and depending on result  - TODO say what?
   */
  readonly onDidDeltaAnalysis = this.deltaEmitter.event;

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

  debugCache(document?: vscode.TextDocument) {
    console.log('Cache size: ' + this.reviewCache.reviewCache.size);
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
   * Store the diagnostics promise in the cache, or update it with the
   * @param document
   * @param review
   */
  setOrUpdate(document: vscode.TextDocument, review: CsReview) {
    const reviewItem = this.reviewCache.get(document);
    if (reviewItem) {
      reviewItem.setReview(document, review);
      void reviewItem.runDeltaAnalysis().finally(() => {
        this.deltaEmitter.fire(reviewItem);
      });
    } else {
      this.reviewCache.set(document, review);
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

  async review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<ReviewResult> {
    const fileName = path.basename(document.fileName);

    // Get the fsPath of the current document because we want to execute the
    // 'cs review' command in the same directory as the current document
    // (i.e. inside the repo to pick up on any .codescene/code-health-config.json file)
    const documentDirectory = dirname(document.uri.fsPath);

    const { stdout, stderr, exitCode, duration } = await this.executor.execute(
      {
        command: this.cliPath,
        args: ['review', '--ide-api','--file-name', fileName],
        taskId: taskId(document),
        ignoreError: true, // Ignore executor errors and handle exitCode/stderr here instead
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
