import vscode from 'vscode';
import { logOutputChannel } from '../log';
import Telemetry from '../telemetry';
import { isDefined, pluralize, showDocAtPosition } from '../utils';
import { DeltaAnalyser, DeltaAnalysisEvent } from './analyser';
import { registerDeltaAnalysisDecorations } from './presentation';
import { DeltaFunctionInfo, DeltaInfoItem, DeltaTreeViewItem, FileWithIssues, refactoringsCount } from './tree-model';

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

    this.treeDataProvider.setParentView(this.view);
    this.treeDataProvider.onDidChangeTreeData(this.handleTreeDataChange, this, this.disposables);
    this.disposables.push(
      this.view,
      vscode.commands.registerCommand('codescene.codeHealthMonitor.revealAutoRefactorings', () =>
        this.revealAutoRefactorings()
      ),
      vscode.commands.registerCommand('codescene.codeHealthMonitorSort', async () => {
        void this.treeDataProvider.selectSortFn();
      }),
      DeltaAnalyser.instance.onDidAnalyse((event) => {
        if (event.type === 'end') {
          this.treeDataProvider.syncTree(event);
        }
      }),
      this.view.onDidChangeVisibility((e) => {
        Telemetry.logUsage('code-health-monitor/visibility', { visible: e.visible });
      }),
      this.view.onDidChangeSelection((e) => {
        this.showDeltaFunctionInfo(e.selection[0]);
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

    // The selection is not yet updated with the new tree data here!
    // Try and find the new data in the tree and update the details view with that
    const selection = this.view.selection[0];
    if (selection instanceof DeltaFunctionInfo) {
      const newItem = this.treeDataProvider.tree
        .flatMap((item) => item.children)
        .find(
          (item) =>
            item instanceof DeltaFunctionInfo && item.fnName === selection.fnName && item.parent === selection.parent
        );
      this.updateFunctionInfoDetails(newItem);
    }
  }

  private showDeltaFunctionInfo(selection?: DeltaTreeViewItem) {
    this.updateFunctionInfoDetails(selection);
    this.goToLocation(selection);
  }

  private updateFunctionInfoDetails(selection?: DeltaTreeViewItem) {
    if (selection instanceof DeltaFunctionInfo) {
      void vscode.commands.executeCommand('codescene.codeHealthDetailsView.showDetails', selection);
      void vscode.commands.executeCommand('codescene.monitorCodeLens.showForFunction', selection);
    } else {
      // else just clear the view
      void vscode.commands.executeCommand('codescene.codeHealthDetailsView.showDetails');
    }
  }

  private goToLocation(selection?: DeltaTreeViewItem) {
    if (selection instanceof DeltaFunctionInfo) {
      void showDocAtPosition(selection.parent.document, selection.range?.start);
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

interface SortOption extends vscode.QuickPickItem {
  label: string;
  sortFn: (a: FileWithIssues, b: FileWithIssues) => number;
}

class DeltaAnalysisTreeProvider implements vscode.TreeDataProvider<DeltaTreeViewItem> {
  private treeDataChangedEmitter: vscode.EventEmitter<DeltaTreeViewItem | void> =
    new vscode.EventEmitter<DeltaTreeViewItem>();
  readonly onDidChangeTreeData: vscode.Event<DeltaTreeViewItem | void> = this.treeDataChangedEmitter.event;

  public fileIssueMap: Map<string, FileWithIssues> = new Map();
  public tree: Array<DeltaTreeViewItem> = [];
  private parentView?: vscode.TreeView<DeltaTreeViewItem>;

  private sortOptions: SortOption[] = [
    {
      label: 'Score change, ascending',
      picked: true,
      description: 'Largest Code Health decline first',
      sortFn: (a: FileWithIssues, b: FileWithIssues) => a.scoreChange - b.scoreChange,
    },
    {
      label: 'Score change, descending',
      description: 'Largest Code Health increase first',
      sortFn: (a: FileWithIssues, b: FileWithIssues) => b.scoreChange - a.scoreChange,
    },
    {
      label: 'File name',
      description: 'Using absolute path',
      sortFn: (a: FileWithIssues, b: FileWithIssues) => (a.document.fileName < b.document.fileName ? -1 : 1),
    },
  ];

  constructor() {}

  setParentView(view: vscode.TreeView<DeltaTreeViewItem>) {
    this.parentView = view;
  }

  public async selectSortFn() {
    const selected = await vscode.window.showQuickPick(this.sortOptions, {
      placeHolder: 'Select sort mode for Code Health Monitor',
    });
    if (selected) {
      this.sortOptions.forEach((o) => (o.picked = false));
      selected.picked = true;
      this.update();
    }
  }

  private update() {
    if (this.fileIssueMap.size > 0) {
      // const statusItem = this.statusTreeItem();
      const filesWithIssues = Array.from(this.fileIssueMap.values());
      const sortOption = this.sortOptions.find((o) => o.picked);
      if (sortOption) {
        filesWithIssues.sort(sortOption.sortFn);
      }

      // const summaryItem = this.issueSummaryItem(filesWithIssues);
      const aceInfoItem = this.aceSummaryItem(filesWithIssues);
      this.tree = aceInfoItem ? [aceInfoItem, ...filesWithIssues] : filesWithIssues;
    } else {
      this.tree = [];
    }
    this.treeDataChangedEmitter.fire(); // Fire this to refresh the tree view
  }

  syncTree({ document, result }: DeltaAnalysisEvent) {
    const evtData = (fileWithIssues: FileWithIssues) => {
      const { nIssues, nRefactorableFunctions, scoreChange } = fileWithIssues;
      return { visible: this.parentView?.visible, scoreChange, nIssues, nRefactorableFunctions };
    };

    // Find the tree item matching the event document
    const fileWithIssues = this.fileIssueMap.get(document.uri.fsPath);
    if (fileWithIssues) {
      if (result) {
        // Update the existing entry if there are changes
        fileWithIssues.update(result, document);
        Telemetry.logUsage('code-health-monitor/file-updated', evtData(fileWithIssues));
      } else {
        // If there are no longer any issues, remove the entry from the tree
        this.fileIssueMap.delete(document.uri.fsPath);
        Telemetry.logUsage('code-health-monitor/file-removed', { visible: this.parentView?.visible });
      }
    } else if (result) {
      // No existing file entry found - add one if there are changes
      const newFileWithIssues = new FileWithIssues(result, document);
      this.fileIssueMap.set(document.uri.fsPath, newFileWithIssues);
      Telemetry.logUsage('code-health-monitor/file-added', evtData(newFileWithIssues));
    }

    this.update();
  }

  private aceSummaryItem(filesWithIssues: FileWithIssues[]) {
    const refactorings = refactoringsCount(filesWithIssues);
    if (refactorings === 0) {
      return;
    }
    const label = `${refactorings} ${pluralize('auto-refactoring', refactorings)} available`;
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
