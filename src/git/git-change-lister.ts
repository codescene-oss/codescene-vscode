import vscode, { Uri } from 'vscode';
import * as path from 'path';
import { API } from '../../types/git';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { Executor } from '../executor';
import { getMergeBaseCommit, isMainBranch, getWorkspacePath } from '../git-utils';
import { getRepo } from '../code-health-monitor/addon';
import { getCommittedChanges, getStatusChanges } from './git-diff-utils';
import { getWorkspaceFolder } from '../utils';
import { SavedFilesTracker } from '../saved-files-tracker';

/**
 * Lists all changed files exhaustively from Git status, and Git diff vs. merge-base.
 */
export class GitChangeLister {
  private executor: Executor;
  private savedFilesTracker: SavedFilesTracker;

  constructor(executor: Executor, savedFilesTracker: SavedFilesTracker) {
    this.executor = executor;
    this.savedFilesTracker = savedFilesTracker;
  }

  // NOTE:
  // At times, Git may not immediately work.
  // However, that doesn't matter, because GitChangeLister is always run within a DroppingScheduledExecutor,
  // so if it fails at the first run, a second one will succeed.
  // We used to have some code trying to avoid that unreliability, but it turned out to be complex and expensive.
  async start(): Promise<void> {
    const workspaceFolder = getWorkspaceFolder();
    if (workspaceFolder) {
      const workspacePath = getWorkspacePath(workspaceFolder);
      const repo = getRepo(workspaceFolder.uri);
      const gitRootPath = repo?.rootUri.fsPath || workspacePath;
      const allChangedFiles = await this.getAllChangedFiles(gitRootPath, workspacePath);
      this.reviewFiles(allChangedFiles);
    }
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
    for (const filePath of filePaths) {
      void this.executor.executeTask(async () => {
        try {
          const document = await vscode.workspace.openTextDocument(filePath);
          CsDiagnostics.review(document, { skipMonitorUpdate: false, updateDiagnosticsPane: false });
        } catch (error) {
          logOutputChannel.error(`Could not review ${filePath}: ${error}`);
        }
      });
    }
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
        const isMain = await isMainBranch(currentBranch, workspacePath);

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
