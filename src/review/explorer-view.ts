import vscode from 'vscode';
import { isDefined, rangeStr } from '../utils';
import Reviewer, { ReviewCacheItem } from './reviewer';
import { chScorePrefix, isCsDiagnosticCode } from './utils';

export class ReviewExplorerView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: ReviewTreeProvider;
  private view: vscode.TreeView<ReviewTreeBranch | ReviewTreeLeaf>;

  constructor() {
    this.treeDataProvider = new ReviewTreeProvider();

    this.view = vscode.window.createTreeView('codescene.explorerCodeReviewView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });
    this.disposables.push(this.view);

    this.view.description = 'CodeScene analysis results';
  }

  dispose() {
    this.treeDataProvider.dispose(); // Dispose and clear the treedataprovider first, emptying the view
    this.view.description = ''; // Don't leave a trailling description when disposing the view

    this.disposables.forEach((d) => d.dispose());
  }
}

class ReviewTreeBranch {
  document: vscode.TextDocument;
  label: string;
  children: ReviewTreeLeaf[] = [];

  constructor(document: vscode.TextDocument, item: ReviewCacheItem) {
    this.document = document;
    const file = document.uri.path.split('/').pop();
    this.label = `${file} - Reviewing...`;

    item.diagnostics
      .then((diagnostics) => {
        const scoreDiagnostic = diagnostics.find((d) => d.message.startsWith(chScorePrefix));
        let score = 'n/a';
        if (isDefined(scoreDiagnostic)) {
          score = scoreDiagnostic.message.replace(chScorePrefix, '');
        }
        this.label = `${file} - ${score}`;
        this.children = diagnostics
          .map((d) => {
            if (d.message.startsWith(chScorePrefix)) return;
            return new ReviewTreeLeaf(this, d);
          })
          .filter(isDefined)
          .sort((a, b) => a.diagnostic.range.start.line - b.diagnostic.range.start.line);
      })
      .catch(() => {
        this.label = `${file} - Error in review`;
      });
  }

  get collapsibleState(): vscode.TreeItemCollapsibleState {
    return this.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
  }
}

class ReviewTreeLeaf {
  label: string;
  parent: ReviewTreeBranch;
  diagnostic: vscode.Diagnostic;

  constructor(parent: ReviewTreeBranch, diagnostic: vscode.Diagnostic) {
    this.parent = parent;
    const code = isCsDiagnosticCode(diagnostic.code) ? diagnostic.code.value.toString() : 'unknown diagnostic code';
    this.label = `${code} ${rangeStr(diagnostic.range)}`;
    this.diagnostic = diagnostic;
  }
}

class ReviewTreeProvider implements vscode.TreeDataProvider<ReviewTreeBranch | ReviewTreeLeaf>, vscode.Disposable {
  private treeDataChangedEmitter = new vscode.EventEmitter<ReviewTreeBranch | ReviewTreeBranch[] | void>();
  private disposables: vscode.Disposable[] = [];
  readonly onDidChangeTreeData = this.treeDataChangedEmitter.event;

  constructor() {
    const reviewStateDisposable = Reviewer.instance.onDidReview(() => {
      this.treeDataChangedEmitter.fire();
    });
    this.disposables.push(reviewStateDisposable);

    const reviewListener = Reviewer.instance.onDidCacheUpdate(() => {
      this.treeDataChangedEmitter.fire();
    });
    this.disposables.push(reviewListener);
  }

  getTreeItem(element: ReviewTreeBranch | ReviewTreeLeaf): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (element instanceof ReviewTreeBranch) {
      const item = new vscode.TreeItem(element.label, element.collapsibleState);
      item.resourceUri = element.document.uri;
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('warning');
    // item.tooltip = new vscode.MarkdownString(...);
    item.command = {
      command: 'codescene.revealRangeInDocument',
      title: 'Show in editor',
      arguments: [element.parent.document, element.diagnostic.range],
    };
    return item;
  }

  getChildren(
    element?: ReviewTreeBranch | ReviewTreeLeaf | undefined
  ): vscode.ProviderResult<ReviewTreeBranch[] | ReviewTreeLeaf[]> {
    if (isDefined(element)) {
      if (element instanceof ReviewTreeBranch) {
        return element.children;
      }
      return []; // No children for ReviewTreeLeaf (issues)
    }

    return buildTreeFromReviewCache();
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

function buildTreeFromReviewCache(): ReviewTreeBranch[] {
  const treeItems: ReviewTreeBranch[] = [];
  Reviewer.instance.reviewCache.forEach((item) => {
    treeItems.push(new ReviewTreeBranch(item.document, item));
  });

  // TODO - sort tree items by score/Reviewing status
  return treeItems;
}
