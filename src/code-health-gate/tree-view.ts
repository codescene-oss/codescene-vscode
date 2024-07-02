import vscode from 'vscode';
import { InteractiveDocsParams } from '../documentation/csdoc-provider';
import { AceAPI, AceRequestEvent } from '../refactoring/addon';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import Reviewer from '../review/reviewer';
import { isDefined, pluralize } from '../utils';
import { DeltaAnalysisResult, DeltaAnalysisState } from './analyser';
import { registerDeltaAnalysisDecorations } from './presentation';
import {
  DeltaFunctionInfo,
  DeltaIssue,
  DeltaTreeViewItem,
  FileWithIssues,
  filesWithIssuesInTree,
  refactoringsInTree,
} from './tree-model';
import { DeltaForFile } from './model';

export class CodeHealthGateView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: DeltaAnalysisTreeProvider;
  private view: vscode.TreeView<DeltaTreeViewItem | DeltaAnalysisResult>;

  constructor(context: vscode.ExtensionContext, aceApi?: AceAPI) {
    registerDeltaAnalysisDecorations(context);

    this.treeDataProvider = new DeltaAnalysisTreeProvider(aceApi);

    this.view = vscode.window.createTreeView('codescene.codeHealthGateView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });

    this.disposables.push(
      this.treeDataProvider.onDidChangeTreeData(() => {
        const results = filesWithIssuesInTree(this.treeDataProvider.tree);
        const refactorings = refactoringsInTree(this.treeDataProvider.tree);
        const descriptionText =
          refactorings > 0 ? `${pluralize('Auto-refactoring', refactorings)} available` : undefined;
        this.view.description = descriptionText;
        const resultsText =
          results.length > 0
            ? `Found ${results.length} ${pluralize('file', results.length)} with introduced code health issues`
            : undefined;
        this.view.badge = {
          value: results.length,
          tooltip: [resultsText, descriptionText].filter(isDefined).join(' • '),
        };
      })
    );

    this.disposables.push(
      this.view,
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

  isVisible() {
    return this.view.visible;
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

  private disposables: vscode.Disposable[] = [];

  public tree: Array<FileWithIssues> = [];

  constructor(aceApi?: AceAPI) {
    this.disposables.push(
      Reviewer.instance.onDidDeltaAnalysis((event) => {
        const { delta, review } = event;
        this.syncTree(review.document, delta);
      })
    );
    if (aceApi) {
      this.disposables.push(aceApi.onDidChangeRequests((e) => this.addRefactoringsToTree(e)));
    }
  }

  private addRefactoringsToTree(event: AceRequestEvent) {
    const fileWithIssues = this.tree.find((f) => f.uri.fsPath === event.document.uri.fsPath);
    if (isDefined(fileWithIssues)) {
      if (event.type === 'start') {
        fileWithIssues.children.forEach((child) => {
          if (child instanceof DeltaFunctionInfo && event.requests) {
            const fnReq = event.requests.find(
              (r) => r.fnToRefactor.name === child.fnName && r.fnToRefactor.range.start.isEqual(child.position)
            );
            child.refactoring = fnReq;
          }
        });
      }
      // Fire and event on both start and end event to update the tree. Never when fileWithIssues is undefined, which 
      // updates the entire tree.
      this.treeDataChangedEmitter.fire(fileWithIssues); 
    }
  }

  private syncTree(document: vscode.TextDocument, deltaForFile?: DeltaForFile) {
    // Find the tree item matching the event document
    const fileWithIssues = this.tree.find((f) => f.uri.fsPath === document.uri.fsPath);
    if (fileWithIssues) {
      if (deltaForFile) {
        // Update the existing entry if there are changes
        fileWithIssues.updateChildren(deltaForFile);
      } else {
        // If there are no longer any issues, remove the entry from the tree
        this.tree = this.tree.filter((f) => f.uri.fsPath !== document.uri.fsPath);
      }
    } else if (deltaForFile) {
      // No existing file entry found - add one if there are changes
      this.tree.push(new FileWithIssues(deltaForFile, document.uri));
    }
    this.treeDataChangedEmitter.fire();
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

    return this.tree;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
