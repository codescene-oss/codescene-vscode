import vscode from 'vscode';
import { DevtoolsAPI } from '../devtools-api';
import { Review } from '../devtools-api/review-model';
import { ReviewOpts } from './reviewer';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { GitIgnoreChecker } from '../git/git-ignore-checker';
import { logOutputChannel } from '../log';

/**
 * A reviewer that respects .gitignore settings.
 *
 * Ignored files are skipped. CachingReviewer wraps this reviewer.
 */
export class FilteringReviewer {
  private gitIgnoreChecker: GitIgnoreChecker;

  constructor() {
    this.gitIgnoreChecker = new GitIgnoreChecker();
  }

  async review(document: vscode.TextDocument, reviewOpts: ReviewOpts): Promise<Review | void> {
    const ignored = await this.gitIgnoreChecker.isIgnored(document);

    if (ignored) {
      logOutputChannel.debug(`[review] skipped path=${document.fileName} reason=gitignored`);
      return;
    }

    return DevtoolsAPI.reviewWithServer(document, reviewOpts);
  }

  async reviewDiagnostics(document: vscode.TextDocument, reviewOpts: ReviewOpts): Promise<void> {
    const ignored = await this.gitIgnoreChecker.isIgnored(document);

    if (ignored) {
      logOutputChannel.debug(`[review] skipped path=${document.fileName} reason=gitignored`);
      return;
    }

    CsDiagnostics.review(document, reviewOpts);
  }

  dispose() {
    this.gitIgnoreChecker.dispose();
  }
}
