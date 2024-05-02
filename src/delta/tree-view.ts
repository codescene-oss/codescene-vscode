import vscode from 'vscode';
import { isDefined } from '../utils';
import { DeltaAnalyser, DeltaAnalysisResult, DeltaAnalysisState } from './analyser';
import { DeltaFinding, FileWithChanges, GitRoot, buildTree, issuesInFiles, resultsInTree } from './tree-model';

export class DeltaAnalysisView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: DeltaAnalysisTreeProvider;
  private view: vscode.TreeView<GitRoot | FileWithChanges | DeltaAnalysisResult | DeltaFinding>;

  constructor() {
    this.treeDataProvider = new DeltaAnalysisTreeProvider();

    this.view = vscode.window.createTreeView('codescene.deltaTreeView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });

    this.treeDataProvider.onDidTreeUpdate((tree) => {
      const results = resultsInTree(tree);
      const issues = issuesInFiles(results);
      this.view.badge = {
        value: results.length,
        tooltip:
          results.length > 0 ? `Found ${results.length} file(s) with declining code health (${issues} issues)` : '',
      };
    });

    this.disposables.push(
      this.view.onDidChangeVisibility((e) => {
        if (e.visible) {
          void vscode.commands.executeCommand('codescene.runDeltaAnalysis');
        }
      })
    );

    this.disposables.push(this.view);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

class DeltaAnalysisTreeProvider
  implements vscode.TreeDataProvider<GitRoot | FileWithChanges | DeltaAnalysisState | DeltaFinding>, vscode.Disposable
{
  private treeDataChangedEmitter: vscode.EventEmitter<
    GitRoot | FileWithChanges | DeltaAnalysisState | DeltaFinding | void
  > = new vscode.EventEmitter<GitRoot | FileWithChanges | DeltaAnalysisState>();
  readonly onDidChangeTreeData: vscode.Event<GitRoot | FileWithChanges | DeltaAnalysisState | DeltaFinding | void> =
    this.treeDataChangedEmitter.event;

  private treeUpdateEmitter: vscode.EventEmitter<Array<GitRoot | FileWithChanges | DeltaAnalysisState>> =
    new vscode.EventEmitter<Array<GitRoot | FileWithChanges | DeltaAnalysisState>>();
  readonly onDidTreeUpdate = this.treeUpdateEmitter.event;

  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      DeltaAnalyser.instance.onDidAnalyse((event) => {
        if (event.type !== 'idle') this.treeDataChangedEmitter.fire();
      })
    );
  }

  getTreeItem(element: GitRoot | FileWithChanges | DeltaAnalysisState | DeltaFinding): vscode.TreeItem {
    if (typeof element === 'string') {
      return element === 'running'
        ? new vscode.TreeItem('Running analysis...', vscode.TreeItemCollapsibleState.None)
        : new vscode.TreeItem('Analysis failed', vscode.TreeItemCollapsibleState.None);
    }

    return element.toTreeItem();
  }

  getChildren(
    element?: GitRoot | FileWithChanges | DeltaAnalysisState | DeltaFinding
  ): vscode.ProviderResult<Array<GitRoot | FileWithChanges | DeltaAnalysisState | DeltaFinding>> {
    if (isDefined(element)) {
      if (typeof element === 'string') return []; // No children for DeltaAnalysisState
      if (element instanceof DeltaFinding) return []; // No children for DeltaFindings
      return element.children;
    }

    const tree = buildTree();
    this.treeUpdateEmitter.fire(tree);
    return tree;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
