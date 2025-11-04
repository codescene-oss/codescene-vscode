import * as path from 'path';
import vscode from 'vscode';
import { DevtoolsAPI } from '../devtools-api';
import { Delta } from '../devtools-api/delta-model';
import { logOutputChannel } from '../log';
import { CsReview } from './cs-review';
import Reviewer from './reviewer';

export class ReviewCacheItem {
  private baselineScore?: Promise<void | string>;
  public documentVersion: number;
  public delta?: Delta;

  constructor(public document: vscode.TextDocument, public review: CsReview) {
    this.documentVersion = document.version;
  }

  setReview(document: vscode.TextDocument, review: CsReview) {
    this.review = review;
    this.documentVersion = document.version;
    void this.runDeltaAnalysis();
  }

  /**
   * Triggers a delta analysis using the raw scores. The analyser will trigger an event on completion
   */
  async runDeltaAnalysis() {
    const oldScore = await this.baselineScore;
    const newScore = await this.review.rawScore;
    this.delta = await DevtoolsAPI.delta(this.document, oldScore, newScore);
  }

  /**
   * Deletes the delta for this item, and makes sure that (empty) DeltaAnalysisEvents are triggered properly
   */
  async deleteDelta() {
    this.delta = await DevtoolsAPI.delta(this.document);
  }

  setBaseline(baselineCommit: string) {
    logOutputChannel.trace(
      `ReviewCacheItem.setBaseline for ${path.basename(this.document.fileName)} to ${baselineCommit}`
    );
    this.baselineScore = Reviewer.instance.baselineScore(baselineCommit, this.document);
    void this.runDeltaAnalysis();
  }
}
