import { dirname } from 'path';
import * as vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { LimitingExecutor, SimpleExecutor } from '../executor';
import { logOutputChannel, outputChannel } from '../log';
import { StatsCollector } from '../stats';
import { getFileExtension } from '../utils';
import { ReviewResult } from './model';
import { reviewIssueToDiagnostics } from './review-utils';

export const chScorePrefix = 'Code health score';

export default class Reviewer {
  private static _instance: IReviewer;

  static init(cliPath: string): void {
    outputChannel.appendLine('Initializing code Reviewer');
    Reviewer._instance = new CachingReviewer(new FilteringReviewer(new SimpleReviewer(cliPath)));
  }

  static get instance(): IReviewer {
    return Reviewer._instance;
  }
}

export interface ReviewOpts {
  [key: string]: string | boolean;
}

export interface IReviewer {
  review(document: vscode.TextDocument, reviewOpts?: ReviewOpts): Promise<vscode.Diagnostic[]>;
}

class SimpleReviewer implements IReviewer {
  private readonly executor: LimitingExecutor = new LimitingExecutor();

  constructor(private cliPath: string) {}

  review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<vscode.Diagnostic[]> {
    const extension = getFileExtension(document.fileName);

    // Get the fsPath of the current document because we want to execute the
    // 'cs review' command in the same directory as the current document
    // (i.e. inside the repo to pick up on any .codescene/code-health-config.json file)
    const documentPath = document.uri.fsPath;
    const documentDirectory = dirname(documentPath);

    const result = this.executor.execute(
      {
        command: this.cliPath,
        args: ['review', '--file-type', extension, '--output-format', 'json'],
        taskId: documentPath,
      },
      { cwd: documentDirectory },
      document.getText()
    );

    const diagnostics = result.then(({ stdout, duration }) => {
      StatsCollector.instance.recordAnalysis(extension, duration);

      const data = JSON.parse(stdout) as ReviewResult;
      let diagnostics = data.review.flatMap((reviewIssue) =>
        reviewIssueToDiagnostics(reviewIssue, document)
      );

      if (data.score > 0) {
        const roundedScore = +data.score.toFixed(2);
        const scoreDiagnostic = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          `${chScorePrefix}: ${roundedScore}`,
          vscode.DiagnosticSeverity.Information
        );
        return [scoreDiagnostic, ...diagnostics];
      } else {
        return diagnostics;
      }
    });

    return diagnostics;
  }
}

// Cache the results of the 'cs review' command so that we don't have to run it again
interface ReviewCacheItem {
  documentVersion: number;
  diagnostics: Promise<vscode.Diagnostic[]>;
}

/**
 * Adds a caching layer on top of a Reviewer.
 */
class CachingReviewer implements IReviewer {
  private readonly reviewCache = new Map<string, ReviewCacheItem>();

  constructor(private reviewer: IReviewer) {}

  review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<vscode.Diagnostic[]> {
    // If we have a cached result for this document, return it.
    if (!reviewOpts.skipCache) {
      const cachedResults = this.reviewCache.get(document.fileName);
      if (cachedResults && cachedResults.documentVersion === document.version) {
        logOutputChannel.debug(`Returning cached diagnostics for ${document.fileName}`);
        return cachedResults.diagnostics;
      }
    }

    const diagnostics = this.reviewer.review(document, reviewOpts);

    // Store result in cache.
    this.reviewCache.set(document.fileName, { documentVersion: document.version, diagnostics });

    return diagnostics;
  }
}

/**
 * A reviewer that respects .gitignore settings.
 *
 * If git is not installed, or if the current document is not part of workspace
 * (i.e. it's opened as a standalone file), then this reviewer will basically be
 * downgraded to the injected reviewer (which for normal use is the CachingReviewer)
 */
class FilteringReviewer implements IReviewer {
  private gitExecutor: SimpleExecutor | null = null;
  private gitExecutorCache = new Map<string, boolean>();

  constructor(private reviewer: IReviewer) {
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

  async review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<vscode.Diagnostic[]> {
    const ignored = await this.isIgnored(document);

    if (ignored) {
      return [];
    }

    return this.reviewer.review(document, reviewOpts);
  }
}
