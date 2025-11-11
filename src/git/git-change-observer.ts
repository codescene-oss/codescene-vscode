import vscode from 'vscode';
import * as path from 'path';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { fireFileDeletedFromGit, getMergeBaseCommit } from '../git-utils';
import { Executor } from '../executor';
import { getRepo } from '../code-health-monitor/addon';
import { getCommittedChanges, getStatusChanges } from './git-diff-utils';

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

  constructor(context: vscode.ExtensionContext, executor: Executor) {
    this.context = context;
    this.executor = executor;
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*',
      false, // Don't ignore create events
      false, // Don't ignore change events
      false  // Don't ignore delete events
    );
  }

  start(): void {
    this.fileWatcher.onDidCreate(this.handleFileChange.bind(this));
    this.fileWatcher.onDidChange(this.handleFileChange.bind(this));
    this.fileWatcher.onDidDelete(this.handleFileDelete.bind(this));

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
      const workspacePath = workspaceFolder.uri.fsPath;
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
    return supportedExtensions.includes(fileExt);
  }

  private isFileInChangedList(filePath: string, changedFiles: string[]): boolean {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return true;
    }

    const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);

    if (!changedFiles.includes(relativePath)) {
      return false;
    }

    return true;
  }

  private async reviewFile(filePath: string): Promise<void> {
    try {
      // Load the file as a TextDocument (doesn't open in editor UI)
      const document = await vscode.workspace.openTextDocument(filePath);
      CsDiagnostics.review(document, { skipMonitorUpdate: false });
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

  private async handleFileChange(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;

    if (!await this.shouldProcessFile(filePath)) {
      return;
    }

    this.tracker.add(filePath);
    void this.executor.executeTask(() => this.reviewFile(filePath));
  }

  private async handleFileDelete(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;

    if (this.tracker.has(filePath)) {
      this.tracker.delete(filePath);
      fireFileDeletedFromGit(filePath);
      return;
    }

    if (await this.shouldProcessFile(filePath)) {
      fireFileDeletedFromGit(filePath);
    }
  }

  dispose(): void {
    this.fileWatcher.dispose();
  }
}
