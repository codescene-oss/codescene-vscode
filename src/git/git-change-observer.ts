import vscode from 'vscode';
import * as path from 'path';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { fireFileDeletedFromGit } from '../git-utils';
import { Executor } from '../executor';

/**
 * Observes discrete Git file changes in real-time.
 */
export class GitChangeObserver {
  private fileWatcher: vscode.FileSystemWatcher;
  private executor: Executor;

  constructor(context: vscode.ExtensionContext, executor: Executor) {
    this.executor = executor;
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*',
      false, // Don't ignore create events
      false, // Don't ignore change events
      false  // Don't ignore delete events
    );

    this.fileWatcher.onDidCreate(this.handleFileChange.bind(this));
    this.fileWatcher.onDidChange(this.handleFileChange.bind(this));
    this.fileWatcher.onDidDelete(this.handleFileDelete.bind(this));

    context.subscriptions.push(this.fileWatcher);
  }

  private async handleFileChange(uri: vscode.Uri): Promise<void> {
    const fileExt = path.extname(uri.fsPath);
    if (!supportedExtensions.includes(fileExt)) {
      return;
    }

    const filePath = uri.fsPath;

    void this.executor.executeTask(async () => {
      try {
        // Load the file as a TextDocument (doesn't open in editor UI)
        const document = await vscode.workspace.openTextDocument(filePath);
        CsDiagnostics.review(document);
      } catch (error) {
        logOutputChannel.warn(`Could not load file for review ${filePath}: ${error}`);
      }
    });
  }

  private handleFileDelete(uri: vscode.Uri): void {
    const fileExt = path.extname(uri.fsPath);
    if (!supportedExtensions.includes(fileExt)) {
      return;
    }
    const filePath = uri.fsPath;
    fireFileDeletedFromGit(filePath);
  }

  dispose(): void {
    this.fileWatcher.dispose();
  }
}
