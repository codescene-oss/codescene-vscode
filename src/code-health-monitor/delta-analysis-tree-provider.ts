import vscode from 'vscode';
import { DeltaAnalysisEvent } from '../devtools-api';
import Telemetry from '../telemetry';
import { isDefined, pluralize } from '../utils';
import { DeltaTreeViewItem, refactoringsCount } from './tree-model';
import { DeltaFunctionInfo } from './delta-function-info';
import { DeltaInfoItem } from './delta-info-item';
import { FileWithIssues } from './file-with-issues';
import { Baseline, CsExtensionState } from '../cs-extension-state';

interface SortOption extends vscode.QuickPickItem {
  label: string;
  sortFn: (a: FileWithIssues, b: FileWithIssues) => number;
}

interface BaselineOption extends vscode.QuickPickItem, Pick<SortOption, 'label'> {
  value: Baseline;
}

export class DeltaAnalysisTreeProvider implements vscode.TreeDataProvider<DeltaTreeViewItem> {
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

  private baselineOptions: BaselineOption[] = [
    {
      label: 'Automatic (default)',
      description:
        'Compare changes against the most recent commit for default branch, and branch creation commit for other branches. Fallback comparison is perfect score (10.0).',
      value: Baseline.default,
    },
    {
      label: 'Branch creation commit',
      description: 'Compare changes since the branch was created. Fallback comparison is perfect score (10.0).',
      value: Baseline.branchCreation,
    },
    {
      label: 'HEAD commit',
      description: 'Compare changes made in the most recent commit. Fallback comparison is perfect score (10.0).',
      value: Baseline.head,
    },
  ];

  constructor() {}

  setParentView(view: vscode.TreeView<DeltaTreeViewItem>) {
    this.parentView = view;
  }

  public async selectBaseline() {
    const currentBaseline = CsExtensionState.baseline;

    const optionsWithStatus = this.baselineOptions.map((option) => ({
      ...option,
      picked: option.value === currentBaseline,
      iconPath: option.value === currentBaseline ? new vscode.ThemeIcon('check') : undefined,
    }));

    const selected = await vscode.window.showQuickPick(optionsWithStatus, {
      placeHolder: 'Select the comparison baseline for the Code Health Monitor',
    });

    if (selected && selected.value !== currentBaseline) {
      await CsExtensionState.setBaseline(selected.value);
      this.update();
    }
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

  private addBaselineInfo() {
    const baseline = CsExtensionState.baseline;

    const data = this.baselineOptions.find((option) => option.value === baseline);
    const label = `Baseline: ${data?.label}`;

    const treeItem = new vscode.TreeItem(label);
    treeItem.iconPath = new vscode.ThemeIcon('info');
    treeItem.tooltip = data?.description;
    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;

    return new DeltaInfoItem(treeItem);
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
      const baselineInfoItem = this.addBaselineInfo();
      const aceInfoItem = this.aceSummaryItem(filesWithIssues);
      this.tree = [baselineInfoItem, ...(aceInfoItem ? [aceInfoItem] : []), ...filesWithIssues];
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
        this.removeTreeEntry(document.uri.fsPath);
      }
    } else if (result) {
      // No existing file entry found - add one if there are changes
      const newFileWithIssues = new FileWithIssues(result, document);
      this.fileIssueMap.set(document.uri.fsPath, newFileWithIssues);
      Telemetry.logUsage('code-health-monitor/file-added', evtData(newFileWithIssues));
    }

    this.update();
  }

  removeTreeEntry(filePath: string) {
    this.fileIssueMap.delete(filePath);
    Telemetry.logUsage('code-health-monitor/file-removed', { visible: this.parentView?.visible });
    this.update();
  }

  clearTree() {
    this.fileIssueMap.clear();
    this.fileIssueMap.forEach((file) =>
      Telemetry.logUsage('code-health-monitor/file-removed', { visible: this.parentView?.visible })
    );
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
