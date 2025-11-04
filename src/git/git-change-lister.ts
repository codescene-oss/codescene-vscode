import vscode, { Uri } from 'vscode';
import * as path from 'path';
import { API, Change } from '../../types/git';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { Executor } from '../executor';

/**
 * Lists all changed files exhaustively from Git state.
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

    const repo = this.gitApi.repositories[0];

    // Check if state is already populated with changes
    const totalChanges = repo.state.indexChanges.length +
      repo.state.workingTreeChanges.length +
      repo.state.untrackedChanges.length;

    if (totalChanges > 0) {
      void this.reviewAllChangedFiles();
      return;
    }

    // State not ready yet, set up listener to wait for changes
    let disposable: vscode.Disposable;
    disposable = repo.state.onDidChange(() => {
      const totalChanges = repo.state.indexChanges.length +
        repo.state.workingTreeChanges.length +
        repo.state.untrackedChanges.length;

      // Only trigger when we actually have changes
      if (totalChanges > 0) {
        disposable.dispose();
        void this.reviewAllChangedFiles();
      }
    });

    context.subscriptions.push(disposable);
  }

  private async reviewAllChangedFiles(): Promise<void> {
    for (const repo of this.gitApi.repositories) {
      const allChanges = [
        ...repo.state.indexChanges,
        ...repo.state.workingTreeChanges,
        ...repo.state.untrackedChanges
      ];

      const addedOrModified = allChanges.filter(change => this.isAddedOrModified(change));

      const filesToReview = addedOrModified
        .filter(change => this.shouldReviewFile(change.uri))
        .map(change => change.uri.fsPath);

      // Remove duplicates
      const uniqueFiles = [...new Set(filesToReview)];

      for (const filePath of uniqueFiles) {
        void this.executor.executeTask(async () => {
          try {
            const document = await vscode.workspace.openTextDocument(filePath);
            CsDiagnostics.review(document, { skipMonitorUpdate: false });
          } catch (error) {
            logOutputChannel.error(`Could not review ${filePath}: ${error}`);
          }
        });
      }
    }
  }

  private shouldReviewFile(fileUri: Uri): boolean {
    const fileExt = path.extname(fileUri.fsPath);
    return supportedExtensions.includes(fileExt);
  }

  private isAddedOrModified(change: Change): boolean {
    return change.status === 0 ||  // INDEX_MODIFIED
      change.status === 1 ||  // INDEX_ADDED
      change.status === 5 ||  // MODIFIED
      change.status === 7 ||  // UNTRACKED
      change.status === 12 || // ADDED_BY_US
      change.status === 13 || // ADDED_BY_THEM
      change.status === 16 || // BOTH_ADDED
      change.status === 18;   // BOTH_MODIFIED
  }
}
