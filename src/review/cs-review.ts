import vscode from 'vscode';
import { Review } from '../devtools-api/review-model';
import { CsDiagnostic } from '../diagnostics/cs-diagnostic';
import { formatScore, reviewResultToDiagnostics } from './utils';

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
