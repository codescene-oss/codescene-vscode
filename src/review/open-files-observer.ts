import vscode from 'vscode';
import { reviewDocumentSelector } from '../language-support';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { FilteringReviewer } from './filtering-reviewer';
import { logOutputChannel } from '../log';
import { DevtoolsAPI } from '../devtools-api';

/**
 * Observes open file events, and triggers reviews accordingly. Reviews of a file as it is on disk
 * only feed Problems, since the CLI watch already reports those to the Code Health Monitor. An
 * unsaved edit is invisible to the CLI, so a review triggered by one owns the monitor entry for
 * that file until it is saved.
 */
export class OpenFilesObserver {
  private reviewTimers = new Map<string, NodeJS.Timeout>();
  private context: vscode.ExtensionContext;
  private readonly docSelector: vscode.DocumentSelector;
  private filteringReviewer = new FilteringReviewer();

  // Tracks files that were opened as visible in the UI.
  // The reason for tracking them is that onDidOpenTextDocument does not reflect files open in the UI and can be called at arbitrary times.
  private visibleDocuments = new Map<string, vscode.TextDocument>();
  private documentVersions = new Map<string, number>();

  // For code to be called just once.
  private hasInitialized = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.docSelector = reviewDocumentSelector();
  }

  private reviewDocument(document: vscode.TextDocument, reason: string, skipMonitorUpdate = true): boolean {
    if (vscode.languages.match(this.docSelector, document) === 0) {
      logOutputChannel.debug(
        `[OpenFilesObserver] skipped path=${document.fileName} reason=unsupported-language languageId=${document.languageId}`
      );
      return false;
    }
    logOutputChannel.debug(
      `[OpenFilesObserver] reviewing path=${document.fileName} reason=${reason} skipMonitor=${skipMonitorUpdate}`
    );
    void this.filteringReviewer.reviewDiagnostics(document, { skipMonitorUpdate, updateDiagnosticsPane: true }).then(() => {
      if (!this.visibleDocuments.has(document.fileName)) {
        DevtoolsAPI.restoreFromDiskIfBufferOwned(document);
      }
    }, () => undefined);
    return true;
  }

  private trackAndReviewDocument(document: vscode.TextDocument, reason: string): void {
    if (!isFileDocument(document)) return;
    const fileName = document.fileName;
    if (this.visibleDocuments.has(fileName)) {
      this.visibleDocuments.set(fileName, document);
      logOutputChannel.debug(`[OpenFilesObserver] skipped path=${fileName} reason=already-tracked`);
      return;
    }
    this.visibleDocuments.set(fileName, document);
    this.reviewDocument(document, reason);
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
    logOutputChannel.debug(`[OpenFilesObserver] untrack path=${fileName}`);
    const document = this.visibleDocuments.get(fileName);
    clearTimeout(this.reviewTimers.get(fileName));
    this.reviewTimers.delete(fileName);
    CsDiagnostics.cancel(fileName);
    CsDiagnostics.set(vscode.Uri.file(fileName), []);
    this.visibleDocuments.delete(fileName);
    this.documentVersions.delete(fileName);
    if (document) DevtoolsAPI.restoreFromDiskIfBufferOwned(document);
  }

  private handleDocumentSaved(document: vscode.TextDocument): void {
    if (!isFileDocument(document)) return;
    DevtoolsAPI.releaseBufferMonitorOwnership(document);
  }

  private untrackIfNotVisible(fileName: string): void {
    if (!this.visibleDocuments.has(fileName)) return;
    if (this.getAllVisibleFileNames().has(fileName)) return;
    this.clearDiagnosticsAndUntrack(fileName);
  }

  private untrackHiddenDocuments(): void {
    if (!this.hasInitialized) return;
    const currentVisibleFiles = this.getAllVisibleFileNames();
    for (const fileName of [...this.visibleDocuments.keys()]) {
      if (!currentVisibleFiles.has(fileName)) {
        this.clearDiagnosticsAndUntrack(fileName);
      }
    }
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
    allVisibleFileNames.forEach((filePath) => {
      const fileUri = vscode.Uri.file(filePath);
      void vscode.workspace.openTextDocument(fileUri).then((document) => {
        this.trackAndReviewDocument(document, reason);
      });
    });
  }

  start(): void {
    this.bindActiveEditorListener();
    this.bindVisibilityListeners();
    this.reviewVisibleEditors('startup');
    this.bindClosedEditorListeners();
    this.bindTextChangeListener();
    this.bindSaveListener();
  }

  private bindActiveEditorListener(): void {
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
        if (!editor || !isFileDocument(editor.document)) return;
        this.trackAndReviewDocument(editor.document, 'editor changed');
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
        else this.untrackHiddenDocuments();
      })
    );
  }

  private bindClosedEditorListeners(): void {
    this.context.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.untrackHiddenDocuments();
      }),
      vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
        this.untrackIfNotVisible(document.fileName);
      })
    );
  }

  private bindSaveListener(): void {
    this.context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
        this.handleDocumentSaved(document);
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
    if (!isFileDocument(e.document)) return;
    const filePath = e.document.fileName;
    if (!this.visibleDocuments.has(filePath)) return;
    if (!this.getAllVisibleFileNames().has(filePath)) {
      logOutputChannel.debug(`[OpenFilesObserver] skipped path=${filePath} reason=not-visible`);
      return;
    }
    if (!e.document.isDirty) {
      logOutputChannel.debug(`[OpenFilesObserver] skipped path=${filePath} reason=clean`);
      return;
    }
    if (this.shouldSkipDocumentChange(e)) {
      const reason = e.contentChanges.length === 0 ? 'empty-change' : 'duplicate-version';
      logOutputChannel.debug(`[OpenFilesObserver] skipped path=${filePath} reason=${reason}`);
      return;
    }
    clearTimeout(this.reviewTimers.get(filePath));
    this.reviewTimers.set(
      filePath,
      setTimeout(() => {
        this.reviewDocument(e.document, 'text changed', false);
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

function isFileDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === 'file';
}
