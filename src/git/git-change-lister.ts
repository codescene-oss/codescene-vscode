import vscode, { Uri } from 'vscode';
import * as path from 'path';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { Executor } from '../executor';
import { getMergeBaseCommit, isMainBranch, getWorkspacePath } from '../git-utils';
import { getRepo } from '../code-health-monitor/addon';
import { getCommittedChanges, getStatusChanges } from './git-diff-utils';
import { getWorkspaceFolder } from '../utils';
import { SavedFilesTracker } from '../saved-files-tracker';
import { consumeWorkspaceFileActivity } from './workspace-activity';
import Reviewer from '../review/reviewer';
import { loadDocumentForBackgroundReview } from '../review/review-document-loader';

/**
 * Lists all changed files exhaustively from Git status, and Git diff vs. merge-base.
 */
export class GitChangeLister {
  private executor: Executor;
  private savedFilesTracker: SavedFilesTracker;
  private getVisibleFileNames?: () => Set<string>;
  private lastChangedFileSetKey: string | undefined;
  private forceNextScan = false;

  constructor(
    executor: Executor,
    savedFilesTracker: SavedFilesTracker,
    getVisibleFileNames?: () => Set<string>
  ) {
    if (!savedFilesTracker) {
      throw new Error('SavedFilesTracker must be provided to GitChangeLister');
    }
    this.executor = executor;
    this.savedFilesTracker = savedFilesTracker;
    this.getVisibleFileNames = getVisibleFileNames;
  }

  /** Forces the next scheduled scan to run git even when the workspace has been idle. */
  markDirty(): void {
    this.forceNextScan = true;
  }

  // NOTE:
  // At times, Git may not immediately work.
  // However, that doesn't matter, because GitChangeLister is always run within a DroppingScheduledExecutor,
  // so if it fails at the first run, a second one will succeed.
  // We used to have some code trying to avoid that unreliability, but it turned out to be complex and expensive.
  async start(): Promise<void> {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return;
    }

    const hadWorkspaceActivity = consumeWorkspaceFileActivity();
    // Skip expensive git work when idle and we already know the changed-file set.
    // markDirty() and workspace file activity force the next scan.
    if (!this.forceNextScan && !hadWorkspaceActivity && this.lastChangedFileSetKey !== undefined) {
      return;
    }

    const workspacePath = getWorkspacePath(workspaceFolder);
    const repo = getRepo(workspaceFolder.uri);
    const gitRootPath = repo?.rootUri.fsPath || workspacePath;
    const allChangedFiles = await this.getAllChangedFiles(gitRootPath, workspacePath);
    const changedFileSetKey = this.serializeChangedFileSet(allChangedFiles);

    // Same files as last scan — no need to enqueue reviews again.
    if (!this.forceNextScan && changedFileSetKey === this.lastChangedFileSetKey) {
      return;
    }

    this.forceNextScan = false;
    this.lastChangedFileSetKey = changedFileSetKey;
    this.reviewFiles(allChangedFiles);
  }

  async getAllChangedFiles(gitRootPath: string, workspacePath: string): Promise<Set<string>> {
    const filesFromRepoState = await this.collectFilesFromRepoState(gitRootPath, workspacePath);
    const filesFromGitDiff = await this.collectFilesFromGitDiff(gitRootPath, workspacePath);
    return new Set([...filesFromRepoState, ...filesFromGitDiff]);
  }

  async collectFilesFromRepoState(gitRootPath: string, workspacePath: string): Promise<Set<string>> {
    const filesToExcludeFromHeuristic = this.savedFilesTracker.getSavedFiles();
    const statusChanges = await getStatusChanges(gitRootPath, workspacePath, filesToExcludeFromHeuristic);
    const files = new Set<string>();

    for (const relativeFilePath of statusChanges) {
      const absolutePath = path.join(workspacePath, relativeFilePath);
      const fileUri = vscode.Uri.file(absolutePath);

      if (this.shouldReviewFile(fileUri)) {
        files.add(absolutePath);
      }
    }

    return files;
  }

  private async collectFilesFromGitDiff(gitRootPath: string, workspacePath: string): Promise<Set<string>> {
    const files = new Set<string>();
    const changedFilesVsMergeBase = await this.getChangedFilesVsMergeBase(gitRootPath, workspacePath);

    for (const relativeFilePath of changedFilesVsMergeBase) {
      const absolutePath = path.join(workspacePath, relativeFilePath);
      const fileUri = vscode.Uri.file(absolutePath);

      if (this.shouldReviewFile(fileUri)) {
        files.add(absolutePath);
      }
    }

    return files;
  }

  private reviewFiles(filePaths: Set<string>): void {
    const visibleFiles = this.getVisibleFileNames?.() ?? new Set<string>();
    const sortedFilePaths = this.sortFilesByPriority(filePaths, visibleFiles);

    for (const filePath of sortedFilePaths) {
      void this.executor.executeTask(async () => {
        try {
          const isVisible = visibleFiles.has(filePath);
          // Background files are read from disk; visible tabs may use openTextDocument.
          const document = await loadDocumentForBackgroundReview(filePath, { allowOpenTextDocument: isVisible });
          if (!document || this.isAlreadyCached(document)) {
            return;
          }
          CsDiagnostics.review(document, { skipMonitorUpdate: false, updateDiagnosticsPane: false });
        } catch (error) {
          logOutputChannel.error(`Could not review ${filePath}: ${error}`);
        }
      });
    }
  }

  private sortFilesByPriority(filePaths: Set<string>, visibleFiles: Set<string>): string[] {
    // Review open/visible files first so the Problems pane and active editor catch up sooner.
    const visible: string[] = [];
    const hidden: string[] = [];

    for (const filePath of filePaths) {
      if (visibleFiles.has(filePath)) {
        visible.push(filePath);
      } else {
        hidden.push(filePath);
      }
    }

    visible.sort();
    hidden.sort();
    return [...visible, ...hidden];
  }

  private isAlreadyCached(document: vscode.TextDocument): boolean {
    // Only skip when the monitor has already been updated (skipMonitorUpdate: false).
    // OpenFilesObserver caches with skipMonitorUpdate: true for the Problems pane only.
    try {
      const reviewCache = Reviewer.instance?.reviewCache;
      if (!reviewCache) {
        return false;
      }
      return !!reviewCache.getExactVersion(document, false);
    } catch {
      return false;
    }
  }

  private serializeChangedFileSet(filePaths: Set<string>): string {
    return Array.from(filePaths).sort().join('\0');
  }

  private shouldReviewFile(fileUri: Uri): boolean {
    const fileExt = path.extname(fileUri.fsPath);
    return supportedExtensions.includes(fileExt);
  }

  async getChangedFilesVsMergeBase(gitRootPath: string, workspacePath: string): Promise<Set<string>> {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return new Set<string>();
    }

    const repo = getRepo(workspaceFolder.uri);
    const baseCommit = repo ? await getMergeBaseCommit(repo) : '';

    if (!baseCommit) {
      const currentBranch = repo?.state.HEAD?.name;
      if (currentBranch){
        const isMain = await isMainBranch(currentBranch, gitRootPath);

        if (!isMain) {
          logOutputChannel.warn('Could not determine merge-base commit');
        }
      }
      return new Set<string>();
    }

    try {
      return await getCommittedChanges(gitRootPath, baseCommit, workspacePath);
    } catch (error) {
      logOutputChannel.warn(`Error getting changed files vs merge-base ${baseCommit}: ${error}`);
      return new Set<string>();
    }
  }
}
