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

/**
 * Lists all changed files exhaustively from Git status, and Git diff vs. merge-base.
 */
export class GitChangeLister {
  private gitApi: API;
  private executor: Executor;

  constructor(gitApi: API, executor: Executor) {
    this.gitApi = gitApi;
    this.executor = executor;
  }

  start(context: vscode.ExtensionContext): void {
    if (this.gitApi.repositories.length === 0) {
      logOutputChannel.error('Code Health Monitor: No repositories found for initial review');
      return;
    }

    void this.startAsync(context);
  }

  async startAsync(context: vscode.ExtensionContext): Promise<void> {

    // Sometimes the Git facilities don't immediately work,
    // so we use isGitAvailable to see if there's evidence of them being immediately available.
    // If not, we set a temporary change listener so that we can operate only when Git finally becomes available.
    if (await this.isGitAvailable()) {
      const allChangedFiles = await this.getAllChangedFiles();
      this.reviewFiles(allChangedFiles);
      return;
    }

    const repo = this.gitApi.repositories[0];

    // State not ready yet, set up listener to wait for changes
    return this.setupChangeListener(repo, context);
  }

  /**
   * Heuristic showing if Git is ready to use.
   */
  private async isGitAvailable(): Promise<boolean> {
    const files = await this.collectFilesFromRepoState();
    if (files.size > 0) {
      return true;
    }

    const gitDiffFiles = await this.collectFilesFromGitDiff();
    return gitDiffFiles.size > 0;
  }

  private async getAllChangedFiles(): Promise<Set<string>> {
    const filesFromRepoState = await this.collectFilesFromRepoState();
    const filesFromGitDiff = await this.collectFilesFromGitDiff();
    return new Set([...filesFromRepoState, ...filesFromGitDiff]);
  }

  private setupChangeListener(repo: any, context: vscode.ExtensionContext): Promise<void> {
    return new Promise<void>((resolve) => {
      let disposable: vscode.Disposable;
      disposable = repo.state.onDidChange(async () => {
        if (await this.isGitAvailable()) {
          const allChangedFiles = await this.getAllChangedFiles();
          if (allChangedFiles.size > 0) {
            this.reviewFiles(allChangedFiles);
            disposable.dispose();
            resolve();
          }
        }
      });

      context.subscriptions.push(disposable);
    });
  }

  async collectFilesFromRepoState(): Promise<Set<string>> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new Set<string>();
    }

    const workspacePath = getWorkspacePath(workspaceFolder);
    const statusChanges = await getStatusChanges(workspacePath);
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

  private async collectFilesFromGitDiff(): Promise<Set<string>> {
    const files = new Set<string>();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return files;
    }
    const changedFilesVsMergeBase = await this.getChangedFilesVsMergeBase();

    for (const relativeFilePath of changedFilesVsMergeBase) {
      const absolutePath = path.join(getWorkspacePath(workspaceFolder), relativeFilePath);
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

  async getChangedFilesVsMergeBase(): Promise<Set<string>> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new Set<string>();
    }

    const repo = getRepo(workspaceFolder.uri);
    const baseCommit = repo ? await getMergeBaseCommit(repo) : '';

    if (!baseCommit) {
      const currentBranch = repo?.state.HEAD?.name;
      if (currentBranch){
        const repoPath = getWorkspacePath(workspaceFolder);
        const isMain = await isMainBranch(currentBranch, repoPath);

        if (!isMain) {
          logOutputChannel.warn('Could not determine merge-base commit');
        }
      }
      return new Set<string>();
    }

    try {
      const workspacePath = getWorkspacePath(workspaceFolder);
      return await getCommittedChanges(baseCommit, workspacePath);
    } catch (error) {
      logOutputChannel.warn(`Error getting changed files vs merge-base ${baseCommit}: ${error}`);
      return new Set<string>();
    }
  }
}
