import vscode from 'vscode';
import * as path from 'path';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { fireFileDeletedFromGit, getMergeBaseCommit } from '../git-utils';
import { Executor } from '../executor';
import { getRepo } from '../code-health-monitor/addon';

/**
 * Observes discrete Git file changes in real-time.
 */
export class GitChangeObserver {
  private fileWatcher: vscode.FileSystemWatcher;
  private executor: Executor;
  private context: vscode.ExtensionContext;

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

  private parseGitStatusFilename(line: string): string | null {

    // e.g. "MM src/foo.clj"
    const match = line.match(/^\S+\s+(.+)$/);

    if (!match?.[1]) {
      return null;
    }

    // Handle renames: "R  old -> new" becomes "new"
    const filename = match[1].includes(' -> ')
      ? match[1].split(' -> ')[1].trim()
      : match[1];

    return filename;
  }

  private async getCommittedChanges(baseCommit: string, workspacePath: string): Promise<Set<string>> {
    const changedFiles = new Set<string>();

    if (!baseCommit) {
      return changedFiles;
    }

    const result = await this.executor.execute(
      { command: 'git', args: ['diff', '--name-only', `${baseCommit}...HEAD`], ignoreError: true },
      { cwd: workspacePath }
    );

    if (result.exitCode === 0) {
      result.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .forEach(file => {
          changedFiles.add(file);
        });
    } else {
      logOutputChannel.warn(`Failed to get committed changes vs ${baseCommit}: ${result.stderr}`);
    }

    return changedFiles;
  }

  private async getStatusChanges(workspacePath: string): Promise<Set<string>> {
    const changedFiles = new Set<string>();

    const result = await this.executor.execute(
      { command: 'git', args: ['status', '--porcelain'], ignoreError: true },
      { cwd: workspacePath }
    );

    if (result.exitCode === 0) {
      result.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .forEach(line => {
          const filename = this.parseGitStatusFilename(line);
          if (filename) {
            changedFiles.add(filename);
          }
        });
    } else {
      logOutputChannel.info(`Failed to get status changes: ${result.stderr}`);
    }

    return changedFiles;
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
      const committedChanges = await this.getCommittedChanges(baseCommit, workspacePath);
      const statusChanges = await this.getStatusChanges(workspacePath);

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

  private async handleFileChange(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;

    if (!this.isSupportedFile(filePath)) {
      return;
    }

    const changedFiles = await this.getChangedFilesVsBaseline();

    if (!this.isFileInChangedList(filePath, changedFiles)) {
      return;
    }

    void this.executor.executeTask(() => this.reviewFile(filePath));
  }

  private handleFileDelete(uri: vscode.Uri): void {
    const filePath = uri.fsPath;

    if (!this.isSupportedFile(filePath)) {
      return;
    }

    fireFileDeletedFromGit(filePath);
  }

  dispose(): void {
    this.fileWatcher.dispose();
  }
}
