import vscode from 'vscode';
import { isDefined, pluralize } from '../utils';

// This is a Empty Treeview to be able to update the badge from the HomeView without first inititating the webview.
// In VSCode TreeViews are initated instantly while webviews are not, therefor we need an interface thats active even before the user has opened codescene
export class BackgroundServiceView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: EmptyProvider;
  private view: vscode.TreeView<vscode.TreeItem>;

  constructor(context: vscode.ExtensionContext) {
    this.treeDataProvider = new EmptyProvider();

    this.view = vscode.window.createTreeView('codescene.backgroundService', {
      treeDataProvider: this.treeDataProvider,
    });
    this.disposables.push(this.view);
  }

  // exposing the updateBadge function fo other views can access it.
  updateBadge(count: number) {
    const resultsText =
      count > 0 ? `Found ${count} ${pluralize('file', count)} with introduced code health issues` : undefined;
    this.view.badge = {
      value: count,
      tooltip: [resultsText].filter(isDefined).join(' • '),
    };
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

// A do-nothing provider: no children; getTreeItem never used.
class EmptyProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    // No items at all
    return [];
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    // Would only run if getChildren returned items
    return element;
  }
}
