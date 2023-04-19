import { dirname } from 'path';
import * as vscode from 'vscode';
import { getFileExtension } from '../utils';
import { LimitingExecutor } from '../executor';
import { produceDiagnostic, reviewIssueToDiagnostics } from './utils';
import { ReviewResult } from './model';

export interface ReviewOpts {
  [key: string]: string;
}

export interface Reviewer {
  review(document: vscode.TextDocument, reviewOpts: ReviewOpts): Promise<vscode.Diagnostic[]>;
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