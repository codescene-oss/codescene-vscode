import vscode from 'vscode';
import { DevtoolsAPI, DeltaAnalysisEvent } from '../devtools-api';
import { logOutputChannel } from '../log';
import Telemetry from '../telemetry';
import { isDefined, pluralize, showDocAtPosition } from '../utils';
import { registerDeltaAnalysisDecorations } from './presentation';
import { DeltaTreeViewItem } from './tree-model';
import { DeltaFunctionInfo } from './delta-function-info';
import { FileWithIssues } from './file-with-issues';
import { onFileDeletedFromGit } from '../git-utils';
import { onTreeDataCleared } from './addon';
import { DeltaAnalysisTreeProvider } from './delta-analysis-tree-provider';

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
      DevtoolsAPI.onDidDeltaAnalysisComplete((e: DeltaAnalysisEvent) => {
        if (e.updateMonitor) {
          this.treeDataProvider.syncTree(e);
        }
      }),
      onFileDeletedFromGit((e) => {
        this.treeDataProvider.removeTreeEntry(e);
      }),
      onTreeDataCleared(() => {
        this.treeDataProvider.clearTree();
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
