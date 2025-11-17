import vscode from 'vscode';
import { reviewDocumentSelector } from '../language-support';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { FilteringReviewer } from './filtering-reviewer';

/**
 * Observes open file events, and triggers reviews accordingly.
 */
export class OpenFilesObserver {
  private reviewTimers = new Map<string, NodeJS.Timeout>();
  private context: vscode.ExtensionContext;
  private readonly docSelector: vscode.DocumentSelector;
  private filteringReviewer = new FilteringReviewer();

  // Tracks files that were opened as visible in the UI.
  // The reason for tracking them is that onDidOpenTextDocument does not reflect files open in the UI and can be called at arbitrary times.
  private visibleDocuments = new Set<string>();

  // For code to be called just once.
  private hasInitialized = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.docSelector = reviewDocumentSelector();
  }

  private reviewDocument(document: vscode.TextDocument): boolean {
    if (vscode.languages.match(this.docSelector, document) === 0) {
      return false;
    }
    void this.filteringReviewer.review(document, { skipMonitorUpdate: true, updateDiagnosticsPane: true });
    return true;
  }

  private trackAndReviewDocument(document: vscode.TextDocument, reason: string): void {
    const fileName = document.fileName;
    if (!this.visibleDocuments.has(fileName)) {
      this.visibleDocuments.add(fileName);
      this.reviewDocument(document);
    }
  }

  private getVisibleTabFileNames(): Set<string> {
    const fileNames = new Set<string>();
    vscode.window.tabGroups.all.forEach((tabGroup) => {
      tabGroup.tabs.forEach((tab) => {
        if (tab.input instanceof vscode.TabInputText) {
          fileNames.add(tab.input.uri.fsPath);
        }
      });
    });
    return fileNames;
  }

  private getAllVisibleFileNames(): Set<string> {
    const fileNames = new Set<string>();

    vscode.window.visibleTextEditors.forEach(editor => {
      fileNames.add(editor.document.fileName);
    });

    this.getVisibleTabFileNames().forEach((fileName) => {
      fileNames.add(fileName);
    });

    return fileNames;
  }

  private clearDiagnosticsAndUntrack(fileName: string): void {
    const uri = vscode.Uri.file(fileName);
    CsDiagnostics.set(uri, []);
    this.visibleDocuments.delete(fileName);
  }

  private pollForVisibleEditors(): void {
    const allVisibleFileNames = this.getAllVisibleFileNames();

    if (allVisibleFileNames.size > 0) {
      this.hasInitialized = true;

      allVisibleFileNames.forEach((filePath) => {
        const fileUri = vscode.Uri.file(filePath);
        // Open the document without showing it in UI
        void vscode.workspace.openTextDocument(fileUri).then((document) => {
          this.trackAndReviewDocument(document, 'startup - visible file');
        });
      });
    } else {
      setTimeout(() => this.pollForVisibleEditors(), 100);
    }
  }

  start(): void {
    // This provides the initial diagnostics when a file becomes visible in the UI (which is NOT the same as opened or having a UI tab for it)
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
        if (!editor) {
          return;
        }
        this.trackAndReviewDocument(editor.document, 'active editor changed');
      })
    );

    setTimeout(() => this.pollForVisibleEditors(), 100);

    // Detect closed editors (onDidCloseTextDocument event hook cannot be trusted as-is, so we use some extra detection)
    this.context.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        if (!this.hasInitialized) {
          return;
        }

        const currentVisibleFiles = this.getAllVisibleFileNames();

        this.visibleDocuments.forEach((candidateFileName) => {
          if (!currentVisibleFiles.has(candidateFileName)) {
            this.clearDiagnosticsAndUntrack(candidateFileName);
          }
        });
      })
    );

    // Additionally to the previous 'closed editors' detection, use onDidCloseTextDocument for extra safety.
    // Keep in mind that onDidCloseTextDocument is not always triggered.
    this.context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
        if (this.visibleDocuments.has(document.fileName)) {
          this.clearDiagnosticsAndUntrack(document.fileName);
        }
      })
    );

    // This provides the diagnostics when a file is edited.
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
        const filePath = e.document.fileName;
        if (!this.visibleDocuments.has(filePath)) {
          return;
        }
        clearTimeout(this.reviewTimers.get(filePath));
        // Run review after 1 second of no edits to this file
        this.reviewTimers.set(
          filePath,
          setTimeout(() => {
            this.reviewDocument(e.document);
          }, 1000)
        );
      })
    );

  }

  dispose(): void {
    // Clear all pending timers
    this.reviewTimers.forEach((timer) => clearTimeout(timer));
    this.reviewTimers.clear();
  }
}
