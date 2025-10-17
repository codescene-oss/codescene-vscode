import * as vscode from 'vscode';
import { CodeSmell } from '../devtools-api/review-model';
import { logOutputChannel } from '../log';
import { reviewDocumentSelector } from '../language-support';
import Reviewer, { ReviewOpts } from '../review/reviewer';

export const csSource = 'CodeScene';

export class CsDiagnostic extends vscode.Diagnostic {
  constructor(
    range: vscode.Range,
    message: string,
    severity: vscode.DiagnosticSeverity,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private _codeSmell?: CodeSmell
  ) {
    let msg;
    if (_codeSmell) {
      msg = `${_codeSmell.category} (${_codeSmell.details})`;
    } else {
      msg = message;
    }
    super(range, msg, severity);
  }

  public get codeSmell() {
    return this._codeSmell;
  }
}

/**
 * Review request queue for ensuring that
 * - only one review for a file runs at a time
 * - only one review request for a file is queued up
 */
class ReviewRequestQueue {
  private ongoingReviews = new Set<string>();
  private reviewQueue = new Map<string, ReviewOpts | undefined>();

  requestReview(fileName: string, reviewOpts?: ReviewOpts): boolean {
    // If there is already a review running for the file, this review will be queued
    // up for running later
    if (this.ongoingReviews.has(fileName)){
      this.reviewQueue.set(fileName, reviewOpts);
      return false;
    }
    this.ongoingReviews.add(fileName);
    return true;
  }

  finishReview(fileName: string) : ReviewOpts | undefined {
    // When review completes, return a queued up review request if there is one
    this.ongoingReviews.delete(fileName);
    if (this.reviewQueue.has(fileName)) {
      const opts = this.reviewQueue.get(fileName);
      this.reviewQueue.delete(fileName);
      return opts;
    }
  }
}

export default class CsDiagnostics {
  // The collection of diagnostics presented in the Problems tab
  private static collection: vscode.DiagnosticCollection;
  private static readonly documentSelector: vscode.DocumentSelector = reviewDocumentSelector();
  private static reviewQueue = new ReviewRequestQueue;

  static init(context: vscode.ExtensionContext) {
    if (!CsDiagnostics.collection) {
      CsDiagnostics.collection = vscode.languages.createDiagnosticCollection('codescene');
      context.subscriptions.push(CsDiagnostics.collection);
    }
  }

  static set(uri: vscode.Uri, diagnostics: CsDiagnostic[]) {
    CsDiagnostics.collection.set(uri, diagnostics);
  }

  static review(document: vscode.TextDocument, reviewOpts?: ReviewOpts) {
    if (vscode.languages.match(CsDiagnostics.documentSelector, document) === 0) {
      return;
    }

    if (!CsDiagnostics.reviewQueue.requestReview(document.fileName, reviewOpts)) {
      logOutputChannel.trace(`Queued up a review of "${document.fileName}"`);
      return;
    }
    
    void Reviewer.instance.review(document, reviewOpts).diagnostics.then((diagnostics) => {
      // Only include diagnostics with actual code smells in the problems view.
      const diagnosticsWithCodeSmells = diagnostics.filter((d) => d.codeSmell !== null);
      CsDiagnostics.set(document.uri, diagnosticsWithCodeSmells);

      const queuedReviewOpts = CsDiagnostics.reviewQueue.finishReview(document.fileName);
      if (queuedReviewOpts) {
        CsDiagnostics.review(document, queuedReviewOpts);
        logOutputChannel.trace(`Fired a queued up review of "${document.fileName}"`);
      }
    });
  }
}
