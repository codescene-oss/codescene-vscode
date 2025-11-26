import * as vscode from 'vscode';

export class MockUri implements vscode.Uri {
  scheme = 'untitled';
  authority = '';
  path = '/mock/document.ts';
  query = '';
  fragment = '';
  fsPath = '/mock/document.ts';

  with(): vscode.Uri {
    throw new Error('not implemented');
  }

  toString(): string {
    return this.fsPath;
  }

  toJSON(): any {
    return { scheme: this.scheme, path: this.path };
  }
}
