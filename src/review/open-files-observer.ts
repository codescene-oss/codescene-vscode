import vscode from 'vscode';
import { reviewDocumentSelector } from '../language-support';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import Reviewer from './reviewer';

/**
 * Observes open file events and triggers reviews accordingly.
 */
export class OpenFilesObserver {
  private reviewTimers = new Map<string, NodeJS.Timeout>();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  start(): void {
    // This provides the initial diagnostics when a file is opened.
    this.context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
        CsDiagnostics.review(document, { skipMonitorUpdate: true });
      })
    );

    // Close document listener for cancelling reviews and refactoring requests
    this.context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
        Reviewer.instance.abort(document);
      })
    );

    const docSelector = reviewDocumentSelector();

    // This provides the diagnostics when a file is edited.
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
        // avoid reviewing non-matching documents
        if (vscode.languages.match(docSelector, e.document) === 0) {
          return;
        }
        const filePath = e.document.fileName;
        clearTimeout(this.reviewTimers.get(filePath));
        // Run review after 1 second of no edits to this file
        this.reviewTimers.set(
          filePath,
          setTimeout(() => {
            CsDiagnostics.review(e.document, { skipMonitorUpdate: true });
          }, 1000)
        );
      })
    );

    // This provides the initial diagnostics when the extension is first activated.
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      CsDiagnostics.review(document, { skipMonitorUpdate: true });
    });
  }

  dispose(): void {
    // Clear all pending timers
    this.reviewTimers.forEach((timer) => clearTimeout(timer));
    this.reviewTimers.clear();
  }
}
