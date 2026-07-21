import * as vscode from 'vscode';

export class MockTextDocumentChangeEvent implements vscode.TextDocumentChangeEvent {
  readonly document: vscode.TextDocument;
  readonly contentChanges: readonly vscode.TextDocumentContentChangeEvent[];
  readonly reason: vscode.TextDocumentChangeReason | undefined;

  constructor(
    document: vscode.TextDocument,
    contentChanges: readonly vscode.TextDocumentContentChangeEvent[] = []
  ) {
    this.document = document;
    this.contentChanges = contentChanges;
    this.reason = undefined;
  }
}
