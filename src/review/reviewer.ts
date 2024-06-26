import { dirname } from 'path';
import vscode from 'vscode';
import { AnalysisEvent } from '../analysis-common';
import { getConfiguration } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { LimitingExecutor, SimpleExecutor } from '../executor';
import { logOutputChannel, outputChannel } from '../log';
import { StatsCollector } from '../stats';
import { getFileExtension } from '../utils';
import { ReviewResult } from './model';
import { formatScore, reviewResultToDiagnostics } from './utils';

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

  constructor(readonly document: vscode.TextDocument, readonly reviewResult: Promise<void | ReviewResult>) {
    this.score = reviewResult.then((reviewResult) => reviewResult?.score);
    this.diagnostics = reviewResult.then((reviewResult) => {
      if (!reviewResult) {
        return [];
      }
      return reviewResultToDiagnostics(reviewResult, document);
    });
  }

  get scorePresentation() {
    return this.score.then((score) => formatScore(score));
  }
}

// Cache the results of the 'cs review' command so that we don't have to run it again
export interface ReviewCacheItem {
  document: vscode.TextDocument;
  documentVersion: number;
  csReview: CsReview;
}

class CachingReviewer {
  readonly reviewCache = new Map<string, ReviewCacheItem>();

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
          return;
        case 'ABORT_ERR':
          // Delete the cache entry for this document if the review was aborted (document closed)
          // Otherwise it won't be reviewed immediately when the document is opened again
          this.reviewCache.delete(document.fileName);
          return;
        default:
          logOutputChannel.error(e.message);
          this.errorEmitter.fire(e); // Fire errors for all other errors
          return;
      }
    }
  }

  review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): CsReview {
    // If we have a cached promise for this document, return it.
    if (!reviewOpts.skipCache) {
      const cachedResults = this.reviewCache.get(document.fileName);
      if (cachedResults && cachedResults.documentVersion === document.version) {
        return cachedResults.csReview;
      }
    }

    this.startReviewEvent(document);
    const reviewPromise = this.reviewer
      .review(document, reviewOpts)
      .then((reviewResult) => {
        // Don't cache reviews of ignored files
        if (!reviewResult) this.reviewCache.delete(document.fileName);
        return reviewResult;
      })
      .catch((e) => this.handleReviewError(e, document))
      .finally(() => {
        this.endReviewEvent(document);
      });

    const csReview = new CsReview(document, reviewPromise);

    // Store the diagnostics promise in the cache
    this.reviewCache.set(document.fileName, {
      document,
      documentVersion: document.version,
      csReview,
    });
    return csReview;
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
    const extension = getFileExtension(document.fileName);

    // Get the fsPath of the current document because we want to execute the
    // 'cs review' command in the same directory as the current document
    // (i.e. inside the repo to pick up on any .codescene/code-health-config.json file)
    const documentDirectory = dirname(document.uri.fsPath);

    const { stdout, stderr, exitCode, duration } = await this.executor.execute(
      {
        command: this.cliPath,
        args: ['review', '--file-type', extension, '--output-format', 'json'],
        taskId: taskId(document),
        ignoreError: true, // Ignore executor errors and handle exitCode/stderr here instead
      },
      { cwd: documentDirectory },
      document.getText()
    );

    if (exitCode !== 0) {
      throw new ReviewError(exitCode, `CodeScene review failed: '${stderr.trim()}' (exit ${exitCode})`);
    }

    StatsCollector.instance.recordAnalysis(extension, duration);
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
