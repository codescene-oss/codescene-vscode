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
import { isGitAvailable } from './git-detection';
import { getWorkspaceFolder } from '../utils';
import { SavedFilesTracker } from '../saved-files-tracker';
import { DroppingScheduledExecutor } from '../dropping-scheduled-executor';
import { SimpleExecutor } from '../simple-executor';
import { OpenFilesObserver } from '../review/open-files-observer';
import { WorkspaceFileWatcher } from './workspace-file-watcher';
import { loadDocumentForBackgroundReview } from '../review/review-document-loader';

/**
 * Observes discrete Git file changes in real-time, filtering them against the Git merge-base.
 */
export class GitChangeObserver {
  private executor: Executor;
  private scheduledExecutor: DroppingScheduledExecutor;
  private context: vscode.ExtensionContext;
  private savedFilesTracker: SavedFilesTracker;
  private openFilesObserver: OpenFilesObserver;
  private workspaceWatcher: WorkspaceFileWatcher;

  // Tracks the files that have been added though this Observer.
  // We need this because deletion events are tricky:
  // - we need to ignore deletions for gitignored files
  // - but we cannot ignore deletions of untracked files
  //   (which may have been added to the Monitor treeview, so they need to be removed on deletion events)
  private tracker: Set<string> = new Set();

  private eventQueue: Array<{type: 'create' | 'change' | 'delete', uri: vscode.Uri}> = [];

  constructor(context: vscode.ExtensionContext, executor: Executor, savedFilesTracker: SavedFilesTracker, openFilesObserver: OpenFilesObserver) {
    if (!savedFilesTracker) {
      throw new Error('SavedFilesTracker must be provided to GitChangeObserver');
    }
    if (!openFilesObserver) {
      throw new Error('OpenFilesObserver must be provided to GitChangeObserver');
    }

    const workspaceWatcher = WorkspaceFileWatcher.getInstance();
    if (!workspaceWatcher) {
      throw new Error('WorkspaceFileWatcher must be initialized before GitChangeObserver');
    }

    this.context = context;
    this.executor = executor;
    this.savedFilesTracker = savedFilesTracker;
    this.openFilesObserver = openFilesObserver;
    this.workspaceWatcher = workspaceWatcher;
    this.scheduledExecutor = new DroppingScheduledExecutor(new SimpleExecutor(), 1);

    this.seedTrackerFromRepoState(executor, savedFilesTracker);
  }

  private seedTrackerFromRepoState(executor: Executor, savedFilesTracker: SavedFilesTracker): void {
    const lister = new GitChangeLister(executor, savedFilesTracker);
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return;
    }

    const workspacePath = getWorkspacePath(workspaceFolder);
    const repo = getRepo(workspaceFolder.uri);
    const gitRootPath = repo?.rootUri.fsPath || workspacePath;
    void lister.collectFilesFromRepoState(gitRootPath, workspacePath).then((files) => {
      for (const file of files) {
        this.tracker.add(file);
      }
    });
  }

  start(): void {
    // Queue create/change/delete from the shared WorkspaceFileWatcher (save/create/delete/rename).
    this.context.subscriptions.push(
      this.workspaceWatcher.onDidFileEvent((event) => {
        this.eventQueue.push({ type: event.type, uri: event.uri });
      })
    );

    void this.scheduledExecutor.executeTask(() => this.processQueuedEvents());
  }

  private async processQueuedEvents(): Promise<void> {
    const events = [...this.eventQueue];
    this.eventQueue = [];

    if (events.length === 0) {
      return;
    }

    const workspaceFolder = getWorkspaceFolder();
    const changedFiles = await this.getChangedFilesVsBaseline(workspaceFolder);

    for (const event of events) {

      // NOTE: we _don't_ need to use gitignore to efficiently determine if a file should be processed,
      // because we use `getChangedFilesVsBaseline` as the computation basis, which uses `git diff` and `git status`,
      // which inherently honor gitignore.

      if (event.type === 'delete' || !this.isFileInChangedList(event.uri.fsPath, changedFiles, workspaceFolder)) {
        await this.handleFileDelete(event.uri, changedFiles, workspaceFolder);
      } else {
        await this.handleFileChange(event.uri, changedFiles, workspaceFolder);
      }
    }
  }

  async getChangedFilesVsBaseline(workspaceFolder: vscode.WorkspaceFolder | undefined): Promise<string[]> {
    if (!isGitAvailable()){
      return [];
    }

    if (!workspaceFolder) {
      return [];
    }

    const repo = getRepo(workspaceFolder.uri);
    const baseCommit = repo ? await getMergeBaseCommit(repo) : '';

    try {
      const workspacePath = getWorkspacePath(workspaceFolder);
      const gitRootPath = repo?.rootUri.fsPath || workspacePath;
      const filesToExcludeFromHeuristic = new Set([
        ...this.savedFilesTracker.getSavedFiles(),
        ...this.openFilesObserver.getAllVisibleFileNames()
      ]);
      const committedChanges = await getCommittedChanges(gitRootPath, baseCommit, workspacePath);
      const statusChanges = await getStatusChanges(gitRootPath, workspacePath, filesToExcludeFromHeuristic);

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

  private isFileInChangedList(filePath: string, changedFiles: string[], workspaceFolder: vscode.WorkspaceFolder | undefined): boolean {
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
      const isVisible = this.openFilesObserver.getAllVisibleFileNames().has(filePath);
      // Load content for review without opening the file in the editor UI when possible.
      const document = await loadDocumentForBackgroundReview(filePath, { allowOpenTextDocument: isVisible });
      if (!document) {
        return;
      }
      CsDiagnostics.review(document, { skipMonitorUpdate: false, updateDiagnosticsPane: false });
    } catch (error) {
      logOutputChannel.warn(`Could not load file for review ${filePath}: ${error}`);
    }
  }

  private shouldProcessFile(filePath: string, changedFiles: string[], workspaceFolder: vscode.WorkspaceFolder | undefined): boolean {
    if (!this.isSupportedFile(filePath)) {
      return false;
    }

    if (!this.isFileInChangedList(filePath, changedFiles, workspaceFolder)) {
      return false;
    }

    return true;
  }

  private async handleFileChange(uri: vscode.Uri, changedFiles: string[], workspaceFolder: vscode.WorkspaceFolder | undefined): Promise<void> {
    const filePath = uri.fsPath;

    // Don't add directories to the tracker - would make deletion handling work incorrectly
    const isDirectory = !path.extname(filePath);
    if (isDirectory) {
      return;
    }

    if (!this.shouldProcessFile(filePath, changedFiles, workspaceFolder)) {
      return;
    }

    this.tracker.add(filePath);
    void this.executor.executeTask(() => this.reviewFile(filePath));
  }

  private async handleFileDelete(uri: vscode.Uri, changedFiles: string[], workspaceFolder: vscode.WorkspaceFolder | undefined): Promise<void> {
    const filePath = uri.fsPath;

    // 1.- Most likely case: internally tracked file
    if (this.tracker.has(filePath)) {
      this.tracker.delete(filePath);
      fireFileDeletedFromGit(filePath);
      return;
    }

    // 2.- Less likely case: non-internally tracked file
    if (this.shouldProcessFile(filePath, changedFiles, workspaceFolder)) {
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

  public removeFromTracker(filePath: string): void {
    this.tracker.delete(filePath);
  }

  dispose(): void {
    this.scheduledExecutor.dispose();
  }
}
