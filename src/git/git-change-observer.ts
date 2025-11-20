import vscode from 'vscode';
import * as path from 'path';
import { API } from '../../types/git';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { fireFileDeletedFromGit, getMergeBaseCommit, getWorkspacePath } from '../git-utils';
import { Executor } from '../executor';
import { getRepo } from '../code-health-monitor/addon';
import { getCommittedChanges, getStatusChanges } from './git-diff-utils';
import { GitChangeLister } from './git-change-lister';

/**
 * Observes discrete Git file changes in real-time, filtering them against the Git merge-base.
 */
export class GitChangeObserver {
  private fileWatcher: vscode.FileSystemWatcher;
  private executor: Executor;
  private context: vscode.ExtensionContext;

  // Tracks the files that have been added though this Observer.
  // We need this because deletion events are tricky:
  // - we need to ignore deletions for gitignored files
  // - but we cannot ignore deletions of untracked files
  //   (which may have been added to the Monitor treeview, so they need to be removed on deletion events)
  private tracker: Set<string> = new Set();

  constructor(context: vscode.ExtensionContext, executor: Executor, gitApi: API) {
    this.context = context;
    this.executor = executor;
    this.fileWatcher = this.createWatcher('**/*');

    // Initially fill the tracker - this ensures `handleFileDelete` works well
    const lister = new GitChangeLister(gitApi, executor);
    void lister.collectFilesFromRepoState().then(files => {
      for (const file of files) {
        this.tracker.add(file);
      }
    });
  }

  start(): void {
    this.bindWatcherEvents(this.fileWatcher);
    this.context.subscriptions.push(this.fileWatcher);
  }

  async getChangedFilesVsBaseline(): Promise<string[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const repo = getRepo(workspaceFolder.uri);
    const baseCommit = repo ? await getMergeBaseCommit(repo) : '';

    try {
      const workspacePath = getWorkspacePath(workspaceFolder);
      const committedChanges = await getCommittedChanges(baseCommit, workspacePath);
      const statusChanges = await getStatusChanges(workspacePath);

      const allChangedFiles = new Set([...committedChanges, ...statusChanges]);

      const result = Array.from(allChangedFiles);
      return result;
    } catch (error) {
      logOutputChannel.warn(`Error getting changed files vs base commit ${baseCommit}: ${error}`);
      return [];
    }
  }

  private isSupportedFile(filePath: string): boolean {
    const fileExt = path.extname(filePath);
    return !!fileExt && supportedExtensions.includes(fileExt);
  }

  private isFileInChangedList(filePath: string, changedFiles: string[]): boolean {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return true;
    }

    const relativePath = path.relative(getWorkspacePath(workspaceFolder), filePath);

    if (!changedFiles.includes(relativePath)) {
      return false;
    }

    return true;
  }

  private async reviewFile(filePath: string): Promise<void> {
    try {
      // Load the file as a TextDocument (doesn't open in editor UI)
      const document = await vscode.workspace.openTextDocument(filePath);
      CsDiagnostics.review(document, { skipMonitorUpdate: false, updateDiagnosticsPane: false });
    } catch (error) {
      logOutputChannel.warn(`Could not load file for review ${filePath}: ${error}`);
    }
  }

  private async shouldProcessFile(filePath: string): Promise<boolean> {
    if (!this.isSupportedFile(filePath)) {
      return false;
    }

    const changedFiles = await this.getChangedFilesVsBaseline();

    if (!this.isFileInChangedList(filePath, changedFiles)) {
      return false;
    }

    return true;
  }

  private createWatcher(pattern: string | vscode.RelativePattern): vscode.FileSystemWatcher {
    return vscode.workspace.createFileSystemWatcher(
      pattern,
      false, // Don't ignore create events
      false, // Don't ignore change events
      false  // Don't ignore delete events
    );
  }

  private bindWatcherEvents(watcher: vscode.FileSystemWatcher): void {
    watcher.onDidCreate(this.handleFileChange.bind(this));
    watcher.onDidChange(this.handleFileChange.bind(this));
    watcher.onDidDelete(this.handleFileDelete.bind(this));
  }

  private async handleFileChange(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;

    // Don't add directories to the tracker - would make deletion handling work incorrectly
    const isDirectory = !path.extname(filePath);
    if (isDirectory) {
      return;
    }

    if (!await this.shouldProcessFile(filePath)) {
      return;
    }

    this.tracker.add(filePath);
    void this.executor.executeTask(() => this.reviewFile(filePath));
  }

  private async handleFileDelete(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;

    // 1.- Most likely case: internally tracked file
    if (this.tracker.has(filePath)) {
      this.tracker.delete(filePath);
      fireFileDeletedFromGit(filePath);
      return;
    }

    // 2.- Less likely case: non-internally tracked file
    if (await this.shouldProcessFile(filePath)) {
      fireFileDeletedFromGit(filePath);
      return;
    }

    // 3.- Least likely case: directory deletion event
    const isDirectory = !path.extname(filePath);

    if (isDirectory) {

      const directoryPrefix = filePath.endsWith(path.sep) ? filePath : filePath + path.sep;
      const filesToDelete = Array.from(this.tracker).filter(trackedFile => trackedFile.startsWith(directoryPrefix));

      for (const fileToDelete of filesToDelete) {
        this.tracker.delete(fileToDelete);
        fireFileDeletedFromGit(fileToDelete);
      }

      if (filesToDelete.length > 0) {
        return;
      }
    }

  }

  dispose(): void {
    this.fileWatcher.dispose();
  }
}
