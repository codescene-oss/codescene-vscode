import vscode, { TreeViewSelectionChangeEvent } from 'vscode';
import { logOutputChannel } from '../log';
import { isDefined, pluralize } from '../utils';
import { DeltaAnalyser, DeltaAnalysisEvent } from './analyser';
import { registerDeltaAnalysisDecorations } from './presentation';
import {
  DeltaFunctionInfo,
  DeltaInfoItem,
  DeltaTreeViewItem,
  errorColor,
  FileWithIssues,
  issuesCount,
  okColor,
  refactoringsCount,
} from './tree-model';

export class CodeHealthMonitorView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: DeltaAnalysisTreeProvider;
  private view: vscode.TreeView<DeltaTreeViewItem>;

  constructor(context: vscode.ExtensionContext) {
    registerDeltaAnalysisDecorations(context);

    this.treeDataProvider = new DeltaAnalysisTreeProvider();

    this.view = vscode.window.createTreeView('codescene.codeHealthMonitorView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
      canSelectMany: false,
    });

    this.treeDataProvider.onDidChangeTreeData(this.handleTreeDataChange, this, this.disposables);
    this.view.onDidChangeSelection(this.handleSelectionChange, this, this.disposables);
    this.disposables.push(
      this.view,
      vscode.commands.registerCommand('codescene.codeHealthMonitor.revealAutoRefactorings', () =>
        this.revealAutoRefactorings()
      ),
      DeltaAnalyser.instance.onDidAnalyse((event) => {
        if (event.type === 'end') {
          this.treeDataProvider.syncTree(event);
        }
      })
    );
  }

  private handleTreeDataChange() {
    const filesWithIssueCount = this.treeDataProvider.fileIssueMap.size;
    const resultsText =
      filesWithIssueCount > 0
        ? `Found ${filesWithIssueCount} ${pluralize('file', filesWithIssueCount)} with introduced code health issues`
        : undefined;
    this.view.badge = {
      value: filesWithIssueCount,
      tooltip: [resultsText].filter(isDefined).join(' • '),
    };

    this.updateFunctionInfoDetails(this.view.selection[0]);
  }

  private handleSelectionChange(e: TreeViewSelectionChangeEvent<DeltaTreeViewItem>) {
    this.updateFunctionInfoDetails(e.selection[0]);
    this.goToLocation(e.selection[0]);
  }

  private updateFunctionInfoDetails(selection?: DeltaTreeViewItem) {
    if (selection instanceof DeltaFunctionInfo) {
      void vscode.commands.executeCommand('codescene.codeHealthDetailsView.showDetails', selection);
    } else {
      // else just clear the view
      void vscode.commands.executeCommand('codescene.codeHealthDetailsView.showDetails');
    }
  }

  private goToLocation(selection?: DeltaTreeViewItem) {
    if (selection instanceof DeltaFunctionInfo) {
      const uri = selection.parent.document.uri;
      const pos = selection.range.start;
      const location = new vscode.Location(uri, pos);
      void vscode.commands.executeCommand('editor.action.goToLocations', uri, pos, [location]);
    }
  }

  private revealAutoRefactorings() {
    this.treeDataProvider.tree.forEach((treeItem) => {
      if (
        treeItem instanceof FileWithIssues &&
        treeItem.functionLevelIssues.some((issue) => issue.isRefactoringSupported)
      ) {
        this.view.reveal(treeItem, { expand: true, select: false, focus: false }).then(
          () => {},
          (error) => logOutputChannel.error(`Failed to reveal auto-refactorings: ${error}`)
        );
      }
    });
  }

  isVisible() {
    return this.view.visible;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

class DeltaAnalysisTreeProvider implements vscode.TreeDataProvider<DeltaTreeViewItem> {
  private treeDataChangedEmitter: vscode.EventEmitter<DeltaTreeViewItem | void> =
    new vscode.EventEmitter<DeltaTreeViewItem>();
  readonly onDidChangeTreeData: vscode.Event<DeltaTreeViewItem | void> = this.treeDataChangedEmitter.event;

  public fileIssueMap: Map<string, FileWithIssues> = new Map();
  public tree: Array<DeltaTreeViewItem> = [];

  constructor() {}

  private update() {
    if (this.fileIssueMap.size > 0) {
      // const statusItem = this.statusTreeItem();
      const filesWithIssues = Array.from(this.fileIssueMap.values());
      // const summaryItem = this.issueSummaryItem(filesWithIssues);
      const aceInfoItem = this.aceSummaryItem(filesWithIssues);
      this.tree = aceInfoItem ? [aceInfoItem, ...filesWithIssues] : filesWithIssues;
    } else {
      this.tree = [];
    }
    this.treeDataChangedEmitter.fire(); // Fire this to refresh the tree view
  }

  syncTree({ document, result }: DeltaAnalysisEvent) {
    // Find the tree item matching the event document
    const fileWithIssues = this.fileIssueMap.get(document.uri.fsPath);
    if (fileWithIssues) {
      if (result) {
        // Update the existing entry if there are changes
        fileWithIssues.update(result, document);
      } else {
        // If there are no longer any issues, remove the entry from the tree
        this.fileIssueMap.delete(document.uri.fsPath);
      }
    } else if (result) {
      // No existing file entry found - add one if there are changes
      this.fileIssueMap.set(document.uri.fsPath, new FileWithIssues(result, document));
    }

    this.update();
  }

  private statusTreeItem() {
    const totalScoreChange = Array.from(this.fileIssueMap.values())
      .map((f) => f.scoreChange)
      .reduce((acc, score) => acc + score, 0);

    let label = 'Code Health unchanged';
    let iconPath = new vscode.ThemeIcon('circle-large');
    let tooltip = 'No changes in code health found';
    if (totalScoreChange > 0) {
      label = 'Code Health improving';
      iconPath = new vscode.ThemeIcon('pass', okColor);
      tooltip = 'Total code health improved';
    } else if (totalScoreChange < 0) {
      label = 'Code Health declining';
      iconPath = new vscode.ThemeIcon('error', errorColor);
      tooltip = 'Total code health declined';
    }

    const statusTreeItem = new vscode.TreeItem(label);
    statusTreeItem.iconPath = iconPath;
    statusTreeItem.tooltip = tooltip;
    return new DeltaInfoItem(statusTreeItem);
  }

  private issueSummaryItem(filesWithIssues: FileWithIssues[]) {
    const issues = issuesCount(filesWithIssues);
    const nFiles = filesWithIssues.length;
    const label = `Found ${issues} ${pluralize('issue', issues)} in ${nFiles} ${pluralize('file', nFiles)}`;

    const tooltip = `CodeScene found ${issues} ${pluralize('issue', issues)} across ${nFiles} ${pluralize(
      'file',
      nFiles
    )}.`;

    const treeItem = new vscode.TreeItem(label);
    treeItem.iconPath = new vscode.ThemeIcon('sparkle');
    treeItem.tooltip = tooltip;
    return new DeltaInfoItem(treeItem);
  }

  private aceSummaryItem(filesWithIssues: FileWithIssues[]) {
    const refactorings = refactoringsCount(filesWithIssues);
    if (refactorings === 0) {
      return;
    }
    const label = `${refactorings} ${pluralize('auto-refactor', refactorings)} available`;
    const tooltip = `Click to expand available refactorings`;
    const aceTreeItem = new vscode.TreeItem(label);
    aceTreeItem.iconPath = new vscode.ThemeIcon('sparkle');
    aceTreeItem.tooltip = tooltip;
    aceTreeItem.command = {
      command: 'codescene.codeHealthMonitor.revealAutoRefactorings',
      title: 'Expand Auto-Refactorings',
    };
    return new DeltaInfoItem(aceTreeItem);
  }

  getTreeItem(element: DeltaTreeViewItem): vscode.TreeItem {
    return element.toTreeItem();
  }

  getChildren(element?: DeltaTreeViewItem): vscode.ProviderResult<Array<DeltaTreeViewItem>> {
    if (isDefined(element)) {
      if (element instanceof DeltaFunctionInfo) return []; // Don't render DeltaIssues when showing functions
      return element.children;
    }
    return this.tree;
  }

  getParent(element: DeltaTreeViewItem): vscode.ProviderResult<DeltaTreeViewItem> {
    return element.parent;
  }
}
