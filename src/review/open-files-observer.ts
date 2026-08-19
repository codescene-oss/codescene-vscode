import vscode from 'vscode';
import { reviewDocumentSelector } from '../language-support';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { FilteringReviewer } from './filtering-reviewer';
import { getMergeBaseCommitForWorkspace } from '../code-health-monitor/addon';
import { logOutputChannel } from '../log';

let openFilesObserverInstance: OpenFilesObserver | undefined;

export function getOpenFilesObserverInstance(): OpenFilesObserver | undefined {
  return openFilesObserverInstance;
}

/**
 * Observes open file events, and triggers reviews accordingly (only meant for Problems, not for the Code Health Monitor).
 */
export class OpenFilesObserver {
  private reviewTimers = new Map<string, NodeJS.Timeout>();
  private context: vscode.ExtensionContext;
  private readonly docSelector: vscode.DocumentSelector;
  private filteringReviewer = new FilteringReviewer();

  // Tracks files that were opened as visible in the UI.
  // The reason for tracking them is that onDidOpenTextDocument does not reflect files open in the UI and can be called at arbitrary times.
  private visibleDocuments = new Set<string>();
  private documentVersions = new Map<string, number>();

  // For code to be called just once.
  private hasInitialized = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.docSelector = reviewDocumentSelector();
    openFilesObserverInstance = this;
  }

  private reviewDocument(document: vscode.TextDocument, baselineCommit: string, reason: string, skipMonitorUpdateForDelta?: boolean): boolean {
    if (vscode.languages.match(this.docSelector, document) === 0) {
      return false;
    }
    logOutputChannel.debug(`[OpenFilesObserver] Reviewing ${document.fileName} (${reason}, baseline: ${baselineCommit || 'none'})`);
    void this.filteringReviewer.reviewDiagnostics(document, { baselineCommit, skipMonitorUpdate: true, updateDiagnosticsPane: true }, skipMonitorUpdateForDelta);
    return true;
  }

  private trackAndReviewDocument(document: vscode.TextDocument, baselineCommit: string, reason: string): void {
    const fileName = document.fileName;
    if (!this.visibleDocuments.has(fileName)) {
      this.visibleDocuments.add(fileName);
      this.reviewDocument(document, baselineCommit, reason);
    }
  }

  private getVisibleTabFileNames(): Set<string> {
    const fileNames = new Set<string>();
    vscode.window.tabGroups.all.forEach((tabGroup) => {
      tabGroup.tabs.forEach((tab) => {
        // Only include file:// scheme URIs (excludes output channels, logs, etc.)
        const isTextInput = tab.input instanceof vscode.TabInputText || (tab.input && typeof tab.input === 'object' && 'uri' in tab.input);
        if (isTextInput && (tab.input as any).uri?.scheme === 'file') {
          fileNames.add((tab.input as any).uri.fsPath);
        }
      });
    });
    return fileNames;
  }

  getAllVisibleFileNames(): Set<string> {
    const fileNames = new Set<string>();

    vscode.window.visibleTextEditors.forEach(editor => {
      // Only include file:// scheme URIs (excludes output channels, logs, etc.)
      if (editor.document.uri.scheme === 'file') {
        fileNames.add(editor.document.fileName);
      }
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
    this.documentVersions.delete(fileName);
  }

  shouldSkipDocumentChange(e: vscode.TextDocumentChangeEvent): boolean {
    if (e.contentChanges.length === 0) {
      return true;
    }
    const filePath = e.document.fileName;
    const newVersion = e.document.version;
    const oldVersion = this.documentVersions.get(filePath);
    if (oldVersion !== undefined && oldVersion === newVersion) {
      return true;
    }
    this.documentVersions.set(filePath, newVersion);
    return false;
  }

  private reviewVisibleEditors(reason: string): void {
    const allVisibleFileNames = this.getAllVisibleFileNames();
    if (allVisibleFileNames.size === 0) return;
    this.hasInitialized = true;
    void getMergeBaseCommitForWorkspace().then((baselineCommit) => {
      const baseline = baselineCommit ?? '';
      allVisibleFileNames.forEach((filePath) => {
        const fileUri = vscode.Uri.file(filePath);
        void vscode.workspace.openTextDocument(fileUri).then((document) => {
          this.trackAndReviewDocument(document, baseline, reason);
        });
      });
    });
  }

  start(): void {
    this.bindActiveEditorListener();
    this.bindVisibilityListeners();
    this.reviewVisibleEditors('startup');
    this.bindClosedEditorListeners();
    this.bindTextChangeListener();
  }

  private bindActiveEditorListener(): void {
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
        if (!editor) return;
        void getMergeBaseCommitForWorkspace().then((baselineCommit) => {
          this.trackAndReviewDocument(editor.document, baselineCommit ?? '', 'editor changed');
        });
      })
    );
  }

  private bindVisibilityListeners(): void {
    this.context.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        if (!this.hasInitialized) this.reviewVisibleEditors('visible editors');
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        if (!this.hasInitialized) this.reviewVisibleEditors('tabs changed');
      })
    );
  }

  private bindClosedEditorListeners(): void {
    this.context.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        if (!this.hasInitialized) return;
        const currentVisibleFiles = this.getAllVisibleFileNames();
        this.visibleDocuments.forEach((candidateFileName) => {
          if (!currentVisibleFiles.has(candidateFileName)) {
            this.clearDiagnosticsAndUntrack(candidateFileName);
          }
        });
      }),
      vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
        if (this.visibleDocuments.has(document.fileName)) {
          this.clearDiagnosticsAndUntrack(document.fileName);
        }
      })
    );
  }

  private bindTextChangeListener(): void {
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
        this.scheduleTextChangeReview(e);
      })
    );
  }

  private scheduleTextChangeReview(e: vscode.TextDocumentChangeEvent): void {
    const filePath = e.document.fileName;
    if (!this.visibleDocuments.has(filePath)) return;
    if (!this.getAllVisibleFileNames().has(filePath)) return;
    if (!e.document.isDirty) return;
    if (this.shouldSkipDocumentChange(e)) return;
    clearTimeout(this.reviewTimers.get(filePath));
    this.reviewTimers.set(
      filePath,
      setTimeout(() => {
        void getMergeBaseCommitForWorkspace().then((baselineCommit) => {
          this.reviewDocument(e.document, baselineCommit ?? '', 'text changed', false);
        });
      }, 1000)
    );
  }

  dispose(): void {
    // Clear all pending timers
    this.reviewTimers.forEach((timer) => clearTimeout(timer));
    this.reviewTimers.clear();
    this.filteringReviewer.dispose();
  }
}
