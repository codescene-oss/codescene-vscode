import { Position } from './position';

export interface Uri {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
  fsPath: string;
  with(change: any): Uri;
  toString(): string;
  toJSON(): any;
}

export class WorkspaceEdit {
  private changes = new Map<string, any[]>();

  insert(uri: Uri, position: Position, newText: string): void {
    const key = uri.toString();
    if (!this.changes.has(key)) {
      this.changes.set(key, []);
    }
    this.changes.get(key)!.push({ position, newText });
  }

  get(uri: Uri): any[] {
    return this.changes.get(uri.toString()) || [];
  }
}
