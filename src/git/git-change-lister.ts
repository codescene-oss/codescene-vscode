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
import { DefaultBranchGate } from './default-branch-gate';

/**
 * Lists all changed files exhaustively from Git status, and Git diff vs. merge-base.
 */
export class GitChangeLister {
  private executor: Executor;
  private savedFilesTracker: SavedFilesTracker;
  private defaultBranchGate: DefaultBranchGate;

  constructor(executor: Executor, savedFilesTracker: SavedFilesTracker, defaultBranchGate: DefaultBranchGate) {
    if (!savedFilesTracker) {
      throw new Error('SavedFilesTracker must be provided to GitChangeLister');
    }
    if (!defaultBranchGate) {
      throw new Error('DefaultBranchGate must be provided to GitChangeLister');
    }
    this.executor = executor;
    this.savedFilesTracker = savedFilesTracker;
    this.defaultBranchGate = defaultBranchGate;
  }

  // NOTE:
  // At times, Git may not immediately work.
  // However, that doesn't matter, because GitChangeLister is always run within a DroppingScheduledExecutor,
  // so if it fails at the first run, a second one will succeed.
  // We used to have some code trying to avoid that unreliability, but it turned out to be complex and expensive.
  async start(): Promise<Set<string>> {
    const workspaceFolder = getWorkspaceFolder();
    if (workspaceFolder) {
      const workspacePath = getWorkspacePath(workspaceFolder);
      const repo = getRepo(workspaceFolder.uri);
      const gitRootPath = repo?.rootUri.fsPath || workspacePath;

      if (repo && await this.defaultBranchGate.shouldSkipBasedOnDefaultBranch(repo)) {
        logOutputChannel.debug('GitChangeLister: skipping processing, current branch matches default branch');
        return new Set<string>();
      }

      const baselineCommit = repo ? await getMergeBaseCommit(repo) : '';
      const allChangedFiles = await this.getAllChangedFiles(gitRootPath, workspacePath, baselineCommit);
      this.reviewFiles(allChangedFiles, baselineCommit);
      return allChangedFiles;
    }
    return new Set<string>();
  }

  async getAllChangedFiles(gitRootPath: string, workspacePath: string, baselineCommit: string): Promise<Set<string>> {
    const filesFromRepoState = await this.collectFilesFromRepoState(gitRootPath, workspacePath);
    const filesFromGitDiff = await this.collectFilesFromGitDiff(gitRootPath, workspacePath, baselineCommit);
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

  private async collectFilesFromGitDiff(gitRootPath: string, workspacePath: string, baselineCommit: string): Promise<Set<string>> {
    const files = new Set<string>();
    const changedFilesVsMergeBase = await this.getChangedFilesVsMergeBase(gitRootPath, workspacePath, baselineCommit);

    for (const relativeFilePath of changedFilesVsMergeBase) {
      const absolutePath = path.join(workspacePath, relativeFilePath);
      const fileUri = vscode.Uri.file(absolutePath);

      if (this.shouldReviewFile(fileUri)) {
        files.add(absolutePath);
      }
    }

    return files;
  }

  private reviewFiles(filePaths: Set<string>, baselineCommit: string): void {
    for (const filePath of filePaths) {
      void this.executor.executeTask(async () => {
        try {
          const document = await vscode.workspace.openTextDocument(filePath);
          CsDiagnostics.review(document, { baselineCommit, skipMonitorUpdate: false, updateDiagnosticsPane: false });
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

  async getChangedFilesVsMergeBase(gitRootPath: string, workspacePath: string, baselineCommit: string): Promise<Set<string>> {
    if (!baselineCommit) {
      const workspaceFolder = getWorkspaceFolder();
      const repo = workspaceFolder ? getRepo(workspaceFolder.uri) : undefined;
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
      return await getCommittedChanges(gitRootPath, baselineCommit, workspacePath);
    } catch (error) {
      logOutputChannel.warn(`Error getting changed files vs merge-base ${baselineCommit}: ${error}`);
      return new Set<string>();
    }
  }
}
