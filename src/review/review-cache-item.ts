import vscode from 'vscode';
import { Delta } from '../devtools-api/delta-model';
import { CsReview } from './cs-review';

export class ReviewCacheItem {
  public documentVersion: number;
  public delta?: Delta;

  constructor(public document: vscode.TextDocument, public review: CsReview) {
    this.documentVersion = document.version;
  }

  setDelta(delta: Delta | undefined) {
    this.delta = delta;
  }

  setReview(document: vscode.TextDocument, review: CsReview) {
    this.review = review;
    this.documentVersion = document.version;
  }
}
