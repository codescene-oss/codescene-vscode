import * as vscode from 'vscode';
import { logOutputChannel } from '../log';
import { reviewDocumentSelector } from '../language-support';
import Reviewer, { ReviewOpts } from '../review/reviewer';
import { CsDiagnostic } from './cs-diagnostic';
import { ReviewRequestQueue } from './review-request-queue';

export const csSource = 'CodeScene';

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

  static review(document: vscode.TextDocument, reviewOpts: ReviewOpts) {
    if (vscode.languages.match(CsDiagnostics.documentSelector, document) === 0) {
      return;
    }

    if (!CsDiagnostics.reviewQueue.requestReview(document.fileName, reviewOpts)) {
      logOutputChannel.trace(`Queued up a review of "${document.fileName}"`);
      return;
    }
    
    void Reviewer.instance.review(document, reviewOpts).diagnostics.then((diagnostics) => {
      if (reviewOpts.updateDiagnosticsPane) {
        // Only include diagnostics with actual code smells in the diagnostics view.
        const diagnosticsWithCodeSmells = diagnostics.filter((d) => d.codeSmell !== null);
        CsDiagnostics.set(document.uri, diagnosticsWithCodeSmells);
      }

      const queuedReviewOpts = CsDiagnostics.reviewQueue.finishReview(document.fileName);
      if (queuedReviewOpts) {
        CsDiagnostics.review(document, queuedReviewOpts);
        logOutputChannel.trace(`Fired a queued up review of "${document.fileName}"`);
      }
    });
  }
}
