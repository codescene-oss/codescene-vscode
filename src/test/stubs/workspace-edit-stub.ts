export class WorkspaceEditStub {
  _edits: any[] = [];
  private changes = new Map<string, any[]>();
  insert(uri: any, position: any, newText: string): void {
    const key = uri.toString();
    if (!this.changes.has(key)) {
      this.changes.set(key, []);
    }
    this.changes.get(key)!.push({ position, newText });
  }
  replace(uri: any, range: any, newText: string): void {
    this._edits.push({ uri, range, newText });
  }
  get(uri: any): any[] {
    return this.changes.get(uri.toString()) || [];
  }
}
