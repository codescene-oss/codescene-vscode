import * as vscode from 'vscode';

export class MockDiagnosticCollection implements vscode.DiagnosticCollection {
  public name = 'test-diagnostics';
  public diagnosticsByUri = new Map<string, readonly vscode.Diagnostic[]>();

  set(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[] | undefined): void;
  set(entries: [vscode.Uri, readonly vscode.Diagnostic[] | undefined][]): void;
  set(uriOrEntries: vscode.Uri | [vscode.Uri, readonly vscode.Diagnostic[] | undefined][], diagnostics?: readonly vscode.Diagnostic[]): void {
    if (Array.isArray(uriOrEntries)) {
      for (const [uri, diags] of uriOrEntries) {
        this.diagnosticsByUri.set(uri.toString(), diags || []);
      }
    } else {
      this.diagnosticsByUri.set(uriOrEntries.toString(), diagnostics || []);
    }
  }

  delete(uri: vscode.Uri): void {
    this.diagnosticsByUri.delete(uri.toString());
  }

  clear(): void {
    this.diagnosticsByUri.clear();
  }

  forEach(callback: (uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[], collection: vscode.DiagnosticCollection) => any, thisArg?: any): void {
    this.diagnosticsByUri.forEach((diagnostics, uriString) => {
      callback.call(thisArg, vscode.Uri.parse(uriString), diagnostics, this);
    });
  }

  get(uri: vscode.Uri): readonly vscode.Diagnostic[] | undefined {
    return this.diagnosticsByUri.get(uri.toString());
  }

  has(uri: vscode.Uri): boolean {
    return this.diagnosticsByUri.has(uri.toString());
  }

  dispose(): void {
    this.clear();
  }

  [Symbol.iterator](): Iterator<[uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]]> {
    const entries = Array.from(this.diagnosticsByUri.entries()).map(([uriString, diagnostics]) =>
      [vscode.Uri.parse(uriString), diagnostics] as [vscode.Uri, readonly vscode.Diagnostic[]]
    );
    return entries[Symbol.iterator]();
  }
}
