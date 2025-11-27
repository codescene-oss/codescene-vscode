import vscode, { Uri } from 'vscode';
import { logOutputChannel } from '../log';

import { CachingReviewer } from './caching-reviewer';
export default class Reviewer {
  private static _instance: CachingReviewer;

  static init(
    context: vscode.ExtensionContext,
    getBaselineCommit: (fileUri: Uri) => Promise<string | undefined>,
    getCodeHealthFileVersions: () => Map<string, number>
  ): void {
    Reviewer._instance = new CachingReviewer(getBaselineCommit, getCodeHealthFileVersions);
    context.subscriptions.push(Reviewer._instance);
    logOutputChannel.info('Code reviewer initialized');
  }

  static get instance(): CachingReviewer {
    return Reviewer._instance;
  }
}

export interface ReviewOpts {
  skipCache?: boolean;
  baseline?: string;
  skipMonitorUpdate: boolean;     // Please set this to true if triggering reviews due to opening files, and to false if triggering reviews due to Git changes.
  //                                 (the reason is that Git changes are always processed anyway, so it's redundant to update the Monitor twice for the same change)
  updateDiagnosticsPane: boolean; // Please set this to true if triggering reviews due to opening files, and to false if triggering reviews due to Git changes.
  //                                 (the reason is that the Diagnostics pane should only refer to files directly open by the User through the UI)
  [key: string]: string | boolean | undefined;
}
