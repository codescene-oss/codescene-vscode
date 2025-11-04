import { dirname } from 'path';
import vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { DevtoolsAPI } from '../devtools-api';
import { Review } from '../devtools-api/review-model';
import { SimpleExecutor } from '../executor';
import { ReviewOpts } from './reviewer';

/**
 * A reviewer that respects .gitignore settings.
 *
 * If git is not installed, or if the current document is not part of workspace
 * (i.e. it's opened as a standalone file), then this reviewer will basically be
 * downgraded to the injected reviewer (which for normal use is the CachingReviewer)
 */
export class FilteringReviewer {
  private gitExecutor: SimpleExecutor | null = null;
  private gitExecutorCache = new Map<string, boolean>();

  constructor() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      this.gitExecutor = new SimpleExecutor();
      const watcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
      watcher.onDidChange(() => this.clearCache());
      watcher.onDidCreate(() => this.clearCache());
      watcher.onDidDelete(() => this.clearCache());
    }
  }

  private clearCache() {
    this.gitExecutorCache = new Map<string, boolean>();
  }

  private async isIgnored(document: vscode.TextDocument) {
    const gitignore = getConfiguration('gitignore');

    if (!gitignore) return false;
    if (!this.gitExecutor) return false;

    const filePath = document.uri.fsPath;

    if (this.gitExecutorCache.has(filePath)) {
      return this.gitExecutorCache.get(filePath);
    }

    const result = await this.gitExecutor.execute(
      { command: 'git', args: ['check-ignore', filePath], ignoreError: true },
      { cwd: dirname(document.uri.fsPath) }
    );

    const ignored = result.exitCode === 0;

    this.gitExecutorCache.set(filePath, ignored);

    return ignored;
  }

  async review(document: vscode.TextDocument, reviewOpts: ReviewOpts = {}): Promise<Review | void> {
    const ignored = await this.isIgnored(document);

    if (ignored) {
      return;
    }

    if (reviewOpts.baseline) {
      return DevtoolsAPI.reviewBaseline(reviewOpts.baseline, document);
    } else {
      return DevtoolsAPI.reviewContent(document);
    }
  }

  abort(document: vscode.TextDocument): void {
    DevtoolsAPI.abortReviews(document);
  }
}
