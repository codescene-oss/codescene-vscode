import vscode from 'vscode';

// A do-nothing provider: no children; getTreeItem never used.
export class EmptyProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    // No items at all
    return [];
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    // Would only run if getChildren returned items
    return element;
  }
}
