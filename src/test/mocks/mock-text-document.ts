import * as vscode from 'vscode';
import { MockUri } from './mock-uri';

export class MockTextDocument implements vscode.TextDocument {
  private _uri: vscode.Uri;

  constructor(content: string, languageId: string) {
    void content;
    void languageId;
    this._uri = new MockUri();
  }

  get uri() {
    return this._uri;
  }

  get fileName() { return ''; }
  get isUntitled() { return true; }
  get languageId() { return ''; }
  get version() { return 1; }
  get isDirty() { return false; }
  get isClosed() { return false; }
  get eol() { return 1; }
  get lineCount() { return 0; }

  lineAt(): vscode.TextLine { throw new Error('not implemented'); }
  offsetAt(): number { throw new Error('not implemented'); }
  positionAt(): vscode.Position { throw new Error('not implemented'); }
  getText(): string { throw new Error('not implemented'); }
  getWordRangeAtPosition(): vscode.Range | undefined { throw new Error('not implemented'); }
  validateRange(range: vscode.Range): vscode.Range { return range; }
  validatePosition(position: vscode.Position): vscode.Position { return position; }
  save(): Thenable<boolean> { throw new Error('not implemented'); }
}
