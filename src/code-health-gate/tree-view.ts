import vscode from 'vscode';
import { AceAPI } from '../refactoring/addon';
import { isDefined } from '../utils';
import { DeltaAnalyser, DeltaAnalysisResult, DeltaAnalysisState } from './analyser';
import {
  DeltaFunctionInfo,
  DeltaIssue,
  DeltaTreeViewItem,
  buildTree,
  countIssuesIn,
  filesWithIssuesInTree,
} from './tree-model';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import { InteractiveDocsParams } from '../documentation/csdoc-provider';

export class CodeHealthGateView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: DeltaAnalysisTreeProvider;
  private view: vscode.TreeView<DeltaTreeViewItem | DeltaAnalysisResult>;

  constructor(aceApi?: AceAPI) {
    this.treeDataProvider = new DeltaAnalysisTreeProvider(aceApi);

    this.view = vscode.window.createTreeView('codescene.codeHealthGateView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });

    this.disposables.push(
      this.treeDataProvider.onDidTreeUpdate((tree) => {
        const results = filesWithIssuesInTree(tree);
        const issues = countIssuesIn(tree);
        this.view.badge = {
          value: results.length,
          tooltip: results.length > 0 ? `Found ${results.length} file(s) with introduced code health issues` : '',
        };
      })
    );

    this.disposables.push(
      this.view.onDidChangeVisibility((e) => {
        if (e.visible) {
          // This is our only automatic trigger of the analysis at the moment.
          // Ignore promise rejection here, since this might be triggered on startup
          // before the command has been registered properly.
          vscode.commands.executeCommand('codescene.runDeltaAnalysis').then(undefined, () => {});
        }
      })
    );

    this.disposables.push(this.view);

    this.disposables.push(
      vscode.commands.registerCommand('codescene.chGateTreeContext.presentRefactoring', (fnInfo: DeltaFunctionInfo) => {
        void vscode.commands.executeCommand('codescene.presentRefactoring', fnInfo.refactoring!.resolvedRefactoring());
      }),
      vscode.commands.registerCommand('codescene.chGateTreeContext.openDocumentation', (issue: DeltaIssue) => {
        let request: CsRefactoringRequest | undefined;
        if (issue.parent instanceof DeltaFunctionInfo) request = issue.parent.refactoring;
        const { position, category } = issue;
        const params: InteractiveDocsParams = {
          codeSmell: { category, position },
          documentUri: issue.parentUri,
          request,
        };
        void vscode.commands.executeCommand('codescene.openInteractiveDocsPanel', params);
      })
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

class DeltaAnalysisTreeProvider
  implements vscode.TreeDataProvider<DeltaTreeViewItem | DeltaAnalysisState>, vscode.Disposable
{
  private treeDataChangedEmitter: vscode.EventEmitter<DeltaTreeViewItem | DeltaAnalysisState | void> =
    new vscode.EventEmitter<DeltaTreeViewItem | DeltaAnalysisState>();
  readonly onDidChangeTreeData: vscode.Event<DeltaTreeViewItem | DeltaAnalysisState | void> =
    this.treeDataChangedEmitter.event;

  private treeUpdateEmitter: vscode.EventEmitter<Array<DeltaTreeViewItem | DeltaAnalysisState>> =
    new vscode.EventEmitter<Array<DeltaTreeViewItem | DeltaAnalysisState>>();
  readonly onDidTreeUpdate = this.treeUpdateEmitter.event;

  private disposables: vscode.Disposable[] = [];

  constructor(aceApi?: AceAPI) {
    this.disposables.push(
      DeltaAnalyser.instance.onDidAnalyse((event) => {
        if (event.type !== 'idle') this.treeDataChangedEmitter.fire();
      })
    );
    if (aceApi) {
      this.disposables.push(
        aceApi.onDidChangeRequests(() => {
          // TODO Maybe debounce this a couple of 100 ms
          this.treeDataChangedEmitter.fire();
        })
      );
    }
  }

  getTreeItem(element: DeltaTreeViewItem | DeltaAnalysisState): vscode.TreeItem {
    if (typeof element === 'string') {
      let msg = 'Analysis failed';
      if (element === 'running') msg = 'Running analysis...';
      if (element === 'no-issues-found') msg = 'No new issues found';
      return new vscode.TreeItem(msg, vscode.TreeItemCollapsibleState.None);
    }

    return element.toTreeItem();
  }

  getChildren(
    element?: DeltaTreeViewItem | DeltaAnalysisState
  ): vscode.ProviderResult<Array<DeltaTreeViewItem | DeltaAnalysisState>> {
    if (isDefined(element)) {
      if (typeof element === 'string') return []; // No children for DeltaAnalysisStates
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
