import vscode, { Uri } from 'vscode';
import { logOutputChannel } from '../log';

import { CachingReviewer } from './caching-reviewer';
export default class Reviewer {
  private static _instance: CachingReviewer;

  static init(
    context: vscode.ExtensionContext,
    getBaselineCommit: (fileUri: Uri) => Promise<string | undefined>
  ): void {
    Reviewer._instance = new CachingReviewer(getBaselineCommit);
    context.subscriptions.push(Reviewer._instance);
    logOutputChannel.info('Code reviewer initialized');
  }

  static get instance(): CachingReviewer {
    return Reviewer._instance;
  }
}

export interface ReviewOpts {
  skipCache?: string;
  baseline?: string;
  skipMonitorUpdate: boolean; // Please set this to false if triggering reviews due to opening files, and to true if triggering reviews due to Git changes.
  [key: string]: string | boolean | undefined;
}
