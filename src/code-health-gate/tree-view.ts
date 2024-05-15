import vscode from 'vscode';
import { isDefined } from '../utils';
import { DeltaAnalyser, DeltaAnalysisResult, DeltaAnalysisState } from './analyser';
import {
  AceRequests,
  DeltaFinding,
  FileWithChanges,
  GitRoot,
  buildTree,
  issuesInFiles,
  resultsInTree,
} from './tree-model';
import { AceAPI } from '../refactoring/addon';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';

export class CodeHealthGateView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: DeltaAnalysisTreeProvider;
  private view: vscode.TreeView<GitRoot | FileWithChanges | DeltaAnalysisResult | DeltaFinding>;

  constructor(aceApi?: AceAPI) {
    this.treeDataProvider = new DeltaAnalysisTreeProvider(aceApi);

    this.view = vscode.window.createTreeView('codescene.codeHealthGateView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });

    this.disposables.push(
      this.treeDataProvider.onDidTreeUpdate((tree) => {
        const results = resultsInTree(tree);
        const issues = issuesInFiles(results);
        this.view.badge = {
          value: results.length,
          tooltip:
            results.length > 0 ? `Found ${results.length} file(s) with declining code health (${issues} issues)` : '',
        };
      })
    );

    this.disposables.push(
      this.view.onDidChangeVisibility((e) => {
        if (e.visible) {
          void vscode.commands.executeCommand('codescene.runDeltaAnalysis');
        }
      })
    );

    this.disposables.push(this.view);

    /*   
      this.disposables.push(
      vscode.commands.registerCommand('codescene.chGateTreeContext.goto', (event: DeltaFinding) => {
        const uri = event.parent.uri;
        const position = event.position;
        const location = new vscode.Location(uri, position);
        void vscode.commands.executeCommand('editor.action.goToLocations', uri, position, [location]);
      })
    );
 */
    this.disposables.push(
      vscode.commands.registerCommand('codescene.chGateTreeContext.requestRefactoring', (event: DeltaFinding) => {
        void vscode.commands.executeCommand('codescene.presentRefactoring', event.refactoring!.resolvedRefactoring());
      })
    );
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

  getTreeItem(element: GitRoot | FileWithChanges | DeltaAnalysisState | DeltaFinding): vscode.TreeItem {
    if (typeof element === 'string') {
      let msg = 'Analysis failed';
      if (element === 'running') msg = 'Running analysis...';
      if (element === 'no-issues-found') msg = 'No new issues found';
      return new vscode.TreeItem(msg, vscode.TreeItemCollapsibleState.None);
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
    return buildTree();
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
