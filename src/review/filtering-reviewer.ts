import { dirname, sep } from 'path';
import vscode from 'vscode';
import { DevtoolsAPI } from '../devtools-api';
import { Review } from '../devtools-api/review-model';
import { SimpleExecutor } from '../simple-executor';
import { ReviewOpts } from './reviewer';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { getWorkspaceFolder } from '../utils';
import { IGNORED_DIRECTORIES } from './ignored_dirs';
import { markGitAsUnavailable, isGitAvailable } from '../git/git-detection';

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
  private watcher: vscode.FileSystemWatcher | null = null;
  private gitAvailabilityCheck: Promise<boolean>;

  constructor() {
    const workspaceFolder = getWorkspaceFolder();
    if (workspaceFolder) {
      this.gitExecutor = new SimpleExecutor();
      this.watcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
      this.watcher.onDidChange(() => this.clearCache());
      this.watcher.onDidCreate(() => this.clearCache());
      this.watcher.onDidDelete(() => this.clearCache());

      this.gitAvailabilityCheck = this.checkGitAvailability();
    } else {
      this.gitAvailabilityCheck = Promise.resolve(false);
    }
  }

  private async checkGitAvailability(): Promise<boolean> {
    if (!this.gitExecutor) {
      return false;
    }

    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return false;
    }

    try {
      // Check if we're in a git repository:
      await this.gitExecutor.execute(
        { command: 'git', args: ['rev-parse', '--git-dir'], ignoreError: false },
        { cwd: workspaceFolder.uri.fsPath }
      );
      return true;
    } catch (error) {
      markGitAsUnavailable();
      return false;
    }
  }

  private clearCache() {
    this.gitExecutorCache = new Map<string, boolean>();
  }

  private isRootLevelHiddenDirectory(filePath: string): boolean {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return false;
    }

    const workspacePath = workspaceFolder.uri.fsPath.split(sep);
    const filePathParts = filePath.split(sep);

    if (filePathParts.length > workspacePath.length) {
      const rootLevelDir = filePathParts[workspacePath.length];
      return Boolean(rootLevelDir && (rootLevelDir.startsWith('.') || rootLevelDir.startsWith('_')));
    }

    return false;
  }

  private containsIgnoredDirectory(filePath: string): boolean {
    const pathParts = filePath.split(sep);
    return pathParts.some((part) => IGNORED_DIRECTORIES.includes(part));
  }

  private async isIgnoredByGit(filePath: string): Promise<boolean> {
    if (!this.gitExecutor) {
      return false;
    }

    const result = await this.gitExecutor.execute(
      { command: 'git', args: ['check-ignore', filePath], ignoreError: true },
      { cwd: dirname(filePath) }
    );

    return result.exitCode === 0;
  }

  private isIgnoredPerHeuristics(filePath: string): boolean {
    // Check if any directory starting with . or _ is exactly at the project root level:
    if (this.isRootLevelHiddenDirectory(filePath)) {
      return true;
    }

    // Check if any directory at any depth contains ignored directories:
    if (this.containsIgnoredDirectory(filePath)) {
      return true;
    }

    return false;
  }

  private async isIgnored(document: vscode.TextDocument) {
    if (!this.gitExecutor) return false;

    await this.gitAvailabilityCheck;

    const filePath = document.uri.fsPath;

    if (this.gitExecutorCache.has(filePath)) {
      return this.gitExecutorCache.get(filePath);
    }

    let ignored: boolean;

    if (isGitAvailable()) {
      ignored = await this.isIgnoredByGit(filePath);
    } else {
      ignored = this.isIgnoredPerHeuristics(filePath);
    }

    this.gitExecutorCache.set(filePath, ignored);
    return ignored;
  }

  async review(document: vscode.TextDocument, reviewOpts: ReviewOpts): Promise<Review | void> {
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

  async reviewDiagnostics(document: vscode.TextDocument, reviewOpts: ReviewOpts): Promise<void> {
    const ignored = await this.isIgnored(document);

    if (ignored) {
      return;
    }

    CsDiagnostics.review(document, reviewOpts);
  }

  abort(document: vscode.TextDocument): void {
    DevtoolsAPI.abortReviews(document);
  }

  dispose() {
    this.watcher?.dispose();
  }
}
