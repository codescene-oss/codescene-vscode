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

  setReview(document: vscode.TextDocument, review: CsReview, skipMonitorUpdate: boolean) {
    this.review = review;
    this.documentVersion = document.version;
    void this.runDeltaAnalysis({ skipMonitorUpdate });
  }

  /**
   * Triggers a delta analysis using the raw scores. The analyser will trigger an event on completion
   */
  async runDeltaAnalysis({ skipMonitorUpdate }: { skipMonitorUpdate: boolean }) {
    // Check if file still exists before running delta analysis to avoid race condition
    // where file is deleted while delta analysis is in progress
    try {
      await vscode.workspace.fs.stat(this.document.uri);
    } catch {
      // File doesn't exist, return early to prevent caching delta for deleted file
      return;
    }

    const oldScore = await this.baselineScore;
    const newScore = await this.review.rawScore;
    this.delta = await DevtoolsAPI.delta(this.document, !skipMonitorUpdate, oldScore, newScore);
  }

  /**
   * Deletes the delta for this item, and makes sure that (empty) DeltaAnalysisEvents are triggered properly
   */
  async deleteDelta(skipMonitorUpdate: boolean) {
    this.delta = await DevtoolsAPI.delta(this.document, !skipMonitorUpdate);
  }

  setBaseline(baselineCommit: string, skipMonitorUpdate: boolean, updateDiagnosticsPane: boolean) {
    logOutputChannel.trace(
      `ReviewCacheItem.setBaseline for ${path.basename(this.document.fileName)} to ${baselineCommit}`
    );
    this.baselineScore = Reviewer.instance.baselineScore(baselineCommit, this.document, skipMonitorUpdate, updateDiagnosticsPane);
    void this.runDeltaAnalysis({ skipMonitorUpdate });
  }
}
