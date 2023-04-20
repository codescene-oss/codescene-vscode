import { dirname } from 'path';
import * as vscode from 'vscode';
import { getFileExtension } from '../utils';
import { LimitingExecutor, SimpleExecutor } from '../executor';
import { produceDiagnostic, reviewIssueToDiagnostics } from './utils';
import { ReviewResult } from './model';

export interface ReviewOpts {
  [key: string]: string | boolean;
}

export interface Reviewer {
  review(document: vscode.TextDocument, reviewOpts?: ReviewOpts): Promise<vscode.Diagnostic[]>;
}

export class SimpleReviewer implements Reviewer {
  private readonly executor: LimitingExecutor = new LimitingExecutor();

  constructor(private cliPath: string) {}

  review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<vscode.Diagnostic[]> {
    const fileExtension = getFileExtension(document.fileName);

    // Get the fsPath of the current document because we want to execute the
    // 'cs review' command in the same directory as the current document
    // (i.e. inside the repo to pick up on any .codescene/code-health-config.json file)
    const documentPath = document.uri.fsPath;
    const documentDirectory = dirname(documentPath);

    const result = this.executor.execute(
      { command: this.cliPath, args: ['review', '-f', fileExtension], taskId: documentPath },
      { cwd: documentDirectory },
      document.getText()
    );

    const diagnostics = result.then(({ stdout }) => {
      const data = JSON.parse(stdout) as ReviewResult;
      let diagnostics = data.review.flatMap((reviewIssue) => reviewIssueToDiagnostics(reviewIssue, document));

      if (data.score > 0) {
        const scoreDiagnostic = produceDiagnostic(
          'info',
          new vscode.Range(0, 0, 0, 0),
          `Code health score: ${data.score}`
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
export class CachingReviewer implements Reviewer {
  private readonly reviewCache = new Map<string, ReviewCacheItem>();

  constructor(private reviewer: Reviewer) {}

  review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<vscode.Diagnostic[]> {
    // If we have a cached result for this document, return it.
    if (!reviewOpts.skipCache) {
      const cachedResults = this.reviewCache.get(document.fileName);
      if (cachedResults && cachedResults.documentVersion === document.version) {
        console.log('CodeScene: returning cached diagnostics for ' + document.fileName);
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
 * downgraded to the injected reviewer.
 */
export class FilteringReviewer implements Reviewer {
  private gitExecutor: SimpleExecutor | null = null;
  private gitExecutorCache = new Map<string, boolean>();

  constructor(private reviewer: Reviewer) {
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
    if (!this.gitExecutor) return false;
    if (!vscode.workspace.getConfiguration('codescene').get('gitignore')) return false;

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
