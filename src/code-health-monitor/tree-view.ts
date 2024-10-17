import vscode, { TreeViewSelectionChangeEvent } from 'vscode';
import { AceAPI, AceRequestEvent } from '../refactoring/addon';
import { isDefined, pluralize } from '../utils';
import { DeltaAnalyser } from './analyser';
import { DeltaForFile } from './model';
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

  constructor(context: vscode.ExtensionContext, aceApi?: AceAPI) {
    registerDeltaAnalysisDecorations(context);

    this.treeDataProvider = new DeltaAnalysisTreeProvider(aceApi);

    this.view = vscode.window.createTreeView('codescene.codeHealthMonitorView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
      canSelectMany: false,
    });

    this.treeDataProvider.onDidChangeTreeData(this.handleTreeDataChange, this, this.disposables);
    this.view.onDidChangeSelection(this.handleSelectionChange, this, this.disposables);
    this.disposables.push(this.view);
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
  }

  private updateFunctionInfoDetails(selection?: DeltaTreeViewItem) {
    if (selection instanceof DeltaFunctionInfo) {
      void vscode.commands.executeCommand('codescene.codeHealthDetailsView.showDetails', selection);
    } else {
      // else just clear the view
      void vscode.commands.executeCommand('codescene.codeHealthDetailsView.showDetails');
    }
  }

  isVisible() {
    return this.view.visible;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

class DeltaAnalysisTreeProvider implements vscode.TreeDataProvider<DeltaTreeViewItem>, vscode.Disposable {
  private treeDataChangedEmitter: vscode.EventEmitter<DeltaTreeViewItem | void> =
    new vscode.EventEmitter<DeltaTreeViewItem>();
  readonly onDidChangeTreeData: vscode.Event<DeltaTreeViewItem | void> = this.treeDataChangedEmitter.event;

  private disposables: vscode.Disposable[] = [];

  public fileIssueMap: Map<string, FileWithIssues> = new Map();

  private tree: Array<DeltaTreeViewItem> = [];

  constructor(aceApi?: AceAPI) {
    this.disposables.push(
      DeltaAnalyser.instance.onDidAnalyse((event) => {
        if (event.type === 'end') {
          const { document, result } = event;
          this.syncTree(document, result);
        }
      })
    );
    if (aceApi) {
      this.disposables.push(aceApi.onDidChangeRequests((e) => this.addRefactoringsToTree(e)));
    }
  }

  update() {
    this.treeDataChangedEmitter.fire(); // Fire this to refresh the tree view
  }

  private addRefactoringsToTree(event: AceRequestEvent) {
    const fileWithIssues = this.fileIssueMap.get(event.document.uri.fsPath);
    if (isDefined(fileWithIssues)) {
      if (event.type === 'start') {
        fileWithIssues.functionLevelIssues.forEach((child) => {
          if (event.requests) {
            const fnReq = event.requests.find(
              (r) => r.fnToRefactor.name === child.fnName && r.fnToRefactor.range.intersection(child.range)
            );
            child.refactoring = fnReq;
          }
        });
      } else if (event.type === 'end') {
        const aceInfo = this.tree[1] as DeltaInfoItem;
        const { label, tooltip } = this.aceInfoContent(Array.from(this.fileIssueMap.values()));
        aceInfo.treeItem.label = label;
        aceInfo.treeItem.tooltip = tooltip;
      }
      fileWithIssues.sortAndSetChildren();
      this.update();
    }
  }

  private syncTree(document: vscode.TextDocument, deltaForFile?: DeltaForFile) {
    // Find the tree item matching the event document
    const fileWithIssues = this.fileIssueMap.get(document.uri.fsPath);
    if (fileWithIssues) {
      if (deltaForFile) {
        // Update the existing entry if there are changes
        fileWithIssues.update(deltaForFile, document.uri);
      } else {
        // If there are no longer any issues, remove the entry from the tree
        this.fileIssueMap.delete(document.uri.fsPath);
      }
    } else if (deltaForFile) {
      // No existing file entry found - add one if there are changes
      this.fileIssueMap.set(document.uri.fsPath, new FileWithIssues(deltaForFile, document.uri));
    }

    if (this.fileIssueMap.size > 0) {
      const statusItem = this.statusTreeItem();
      const filesWithIssues = Array.from(this.fileIssueMap.values());
      const { label, tooltip } = this.aceInfoContent(filesWithIssues);
      const aceTreeItem = new vscode.TreeItem(label);
      aceTreeItem.iconPath = new vscode.ThemeIcon('sparkle');
      aceTreeItem.tooltip = tooltip;
      const aceInfoItem = new DeltaInfoItem(aceTreeItem);

      this.tree = [statusItem, aceInfoItem, ...filesWithIssues];
    } else {
      this.tree = [];
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

  private aceInfoContent(files: FileWithIssues[]) {
    const issues = issuesCount(files);
    const refactorings = refactoringsCount(files);
    const label = `${issues} ${pluralize('issue', issues)}, ${refactorings} ${pluralize(
      'auto-refactor',
      refactorings
    )} available`;

    const tooltip = `CodeScene found ${issues} ${pluralize('issue', issues)} across ${files.length} ${pluralize(
      'file',
      files.length
    )}. ${refactorings} ${pluralize('auto-refactoring', refactorings)} is available.`;
    return { label, tooltip };
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

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
