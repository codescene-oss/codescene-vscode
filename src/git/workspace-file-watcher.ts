import vscode, { Uri } from 'vscode';
import { isSupportedSourceFile } from '../utils/workspace-patterns';
import { markWorkspaceFileActivity } from './workspace-activity';

export type WorkspaceFileEvent = { type: 'create' | 'change' | 'delete'; uri: Uri };

/**
 * Shared workspace file notifications for GitChangeObserver and CachingReviewer.
 * Uses VS Code workspace events instead of FileSystemWatcher globs to avoid ripgrep indexing.
 */
export class WorkspaceFileWatcher implements vscode.Disposable {
  private static instance: WorkspaceFileWatcher | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly deleteEmitter = new vscode.EventEmitter<Uri>();
  private readonly fileEventEmitter = new vscode.EventEmitter<WorkspaceFileEvent>();

  readonly onDidDelete = this.deleteEmitter.event;
  readonly onDidFileEvent = this.fileEventEmitter.event;

  static init(context: vscode.ExtensionContext): WorkspaceFileWatcher | undefined {
    if (WorkspaceFileWatcher.instance) {
      return WorkspaceFileWatcher.instance;
    }

    WorkspaceFileWatcher.instance = new WorkspaceFileWatcher(context);
    context.subscriptions.push(WorkspaceFileWatcher.instance);
    return WorkspaceFileWatcher.instance;
  }

  static getInstance(): WorkspaceFileWatcher | undefined {
    return WorkspaceFileWatcher.instance;
  }

  static disposeShared(): void {
    WorkspaceFileWatcher.instance?.dispose();
    WorkspaceFileWatcher.instance = undefined;
  }

  private constructor(context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => this.handleChange(document.uri)),
      vscode.workspace.onDidCreateFiles((event) => {
        for (const uri of event.files) {
          this.handleCreate(uri);
        }
      }),
      vscode.workspace.onDidDeleteFiles((event) => {
        for (const uri of event.files) {
          this.handleDelete(uri);
        }
      }),
      vscode.workspace.onDidRenameFiles((event) => {
        for (const { oldUri, newUri } of event.files) {
          this.handleDelete(oldUri);
          this.handleCreate(newUri);
        }
      })
    );
    context.subscriptions.push(...this.disposables);
  }

  private handleCreate(uri: Uri): void {
    if (!isSupportedSourceFile(uri.fsPath)) {
      return;
    }
    markWorkspaceFileActivity();
    this.fileEventEmitter.fire({ type: 'create', uri });
  }

  private handleChange(uri: Uri): void {
    // File content changes are observed on save, not on every keystroke.
    if (!isSupportedSourceFile(uri.fsPath)) {
      return;
    }
    markWorkspaceFileActivity();
    this.fileEventEmitter.fire({ type: 'change', uri });
  }

  private handleDelete(uri: Uri): void {
    markWorkspaceFileActivity();
    // Always emit delete — CachingReviewer clears cache for any deleted path.
    this.deleteEmitter.fire(uri);
    if (isSupportedSourceFile(uri.fsPath)) {
      this.fileEventEmitter.fire({ type: 'delete', uri });
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.deleteEmitter.dispose();
    this.fileEventEmitter.dispose();
  }
}
