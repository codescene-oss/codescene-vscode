import vscode from 'vscode';

export class SavedFilesTracker {
  private savedFiles: Set<string> = new Set();
  private context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  start(): void {
    const saveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
      this.onFileSaved(document);
    });
    this.disposables.push(saveDisposable);
    this.context.subscriptions.push(saveDisposable);
  }

  private onFileSaved(document: vscode.TextDocument): void {
    const filePath = document.fileName;

    if (this.isFileOpenInEditor(filePath)) {
      this.savedFiles.add(filePath);
    }
  }

  private isFileOpenInEditor(filePath: string): boolean {
    const isVisible = vscode.window.visibleTextEditors.some(
      (editor) => editor.document.fileName === filePath
    );

    if (isVisible) {
      return true;
    }

    const isInTab = vscode.window.tabGroups.all.some((tabGroup) =>
      tabGroup.tabs.some((tab) =>
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.fsPath === filePath));

    return isInTab;
  }

  getSavedFiles(): Set<string> {
    return new Set(this.savedFiles);
  }

  clearSavedFiles(): void {
    this.savedFiles.clear();
  }

  removeFromTracker(filePath: string): void {
    this.savedFiles.delete(filePath);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.savedFiles.clear();
  }
}
