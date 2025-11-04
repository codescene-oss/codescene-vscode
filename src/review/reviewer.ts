import { dirname } from 'path';
import vscode, { Disposable, Uri } from 'vscode';
import { Repository } from '../../types/git';
import { getConfiguration } from '../configuration';
import { AbortError, DevtoolsAPI } from '../devtools-api';
import { Delta } from '../devtools-api/delta-model';
import { Review } from '../devtools-api/review-model';
import { CsDiagnostic } from '../diagnostics/cs-diagnostics';
import { SimpleExecutor } from '../executor';
import { logOutputChannel } from '../log';
import { formatScore, reviewResultToDiagnostics } from './utils';

import * as path from 'path';
import { CsReview } from './cs-review';
import { ReviewCacheItem } from './review-cache-item';
import { ReviewCache } from './review-cache';
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
  [key: string]: string | string;
}
