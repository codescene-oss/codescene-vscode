import vscode from 'vscode';
import { DevtoolsAPI } from '../devtools-api';
import { Review } from '../devtools-api/review-model';
import { ReviewOpts } from './reviewer';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { GitIgnoreChecker } from '../git/git-ignore-checker';

/**
 * A reviewer that respects .gitignore settings.
 *
 * If git is not installed, or if the current document is not part of workspace
 * (i.e. it's opened as a standalone file), then this reviewer will basically be
 * downgraded to the injected reviewer (which for normal use is the CachingReviewer)
 */
export class FilteringReviewer {
  private gitIgnoreChecker: GitIgnoreChecker;

  constructor() {
    this.gitIgnoreChecker = new GitIgnoreChecker();
  }

  async review(document: vscode.TextDocument, reviewOpts: ReviewOpts): Promise<Review | void> {
    const ignored = await this.gitIgnoreChecker.isIgnored(document);

    if (ignored) {
      return;
    }

    if (reviewOpts.baseline) {
      return DevtoolsAPI.reviewBaseline(reviewOpts.baseline, document);
    } else {
      return DevtoolsAPI.reviewContent(document);
    }
  }

  async reviewDiagnostics(document: vscode.TextDocument, reviewOpts: ReviewOpts, skipMonitorUpdateForDelta?: boolean): Promise<void> {
    const ignored = await this.gitIgnoreChecker.isIgnored(document);

    if (ignored) {
      return;
    }

    CsDiagnostics.review(document, reviewOpts, skipMonitorUpdateForDelta);
  }

  abort(document: vscode.TextDocument): void {
    DevtoolsAPI.abortReviews(document);
  }

  dispose() {
    this.gitIgnoreChecker.dispose();
  }
}
