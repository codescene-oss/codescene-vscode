import vscode from 'vscode';
import { roundScore } from '../review/utils';
import { isDefined } from '../utils';
import { DeltaAnalyser, DeltaAnalysisResult, DeltaAnalysisState } from './analyser';
import { DeltaForFile } from './model';

export class DeltaAnalysisView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: DeltaAnalysisTreeProvider;
  private view: vscode.TreeView<GitRoot | DeltaResult | DeltaFinding>;

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

function issuesInFiles(items: Array<DeltaResult | DeltaFinding>): number {
  return items.reduce((prev, curr) => {
    if (curr instanceof DeltaFinding) {
      return prev + 1; // Count DeltaFindings
    }
    return prev + issuesInFiles(curr.children); // Recurse into DeltaFindings
  }, 0);
}

function resultsInTree(items: Array<GitRoot | DeltaResult>): DeltaResult[] {
  const deltaResults: DeltaResult[] = [];
  items.forEach((item) => {
    if (item instanceof DeltaResult) {
      if (typeof item.result !== 'string') deltaResults.push(item); // Only count when result is done
      return;
    }
    deltaResults.push(...resultsInTree(item.children));
  });
  return deltaResults;
}

class DeltaAnalysisTreeProvider
  implements vscode.TreeDataProvider<GitRoot | DeltaResult | DeltaFinding>, vscode.Disposable
{
  private treeDataChangedEmitter: vscode.EventEmitter<GitRoot | DeltaResult | DeltaFinding | void> =
    new vscode.EventEmitter<GitRoot | DeltaResult>();
  readonly onDidChangeTreeData: vscode.Event<GitRoot | DeltaResult | DeltaFinding | void> =
    this.treeDataChangedEmitter.event;

  private treeUpdateEmitter: vscode.EventEmitter<Array<GitRoot | DeltaResult>> = new vscode.EventEmitter<
    Array<GitRoot | DeltaResult>
  >();
  readonly onDidTreeUpdate = this.treeUpdateEmitter.event;

  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      DeltaAnalyser.instance.onDidAnalysisEnd(() => {
        this.treeDataChangedEmitter.fire();
      }),
      DeltaAnalyser.instance.onDidAnalysisStart(() => {
        this.treeDataChangedEmitter.fire();
      })
    );
  }

  getTreeItem(element: GitRoot | DeltaResult | DeltaFinding): vscode.TreeItem {
    if (element instanceof GitRoot) {
      return new vscode.TreeItem(element.label, element.collapsibleState);
    }
    if (element instanceof DeltaResult) {
      return new vscode.TreeItem(element.label, element.collapsibleState);
    }
    return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
  }

  getChildren(
    element?: GitRoot | DeltaResult | DeltaFinding
  ): vscode.ProviderResult<Array<GitRoot | DeltaResult | DeltaFinding>> {
    if (isDefined(element)) {
      if (element instanceof GitRoot) {
        return element.children;
      }
      if (element instanceof DeltaResult) {
        return element.children;
      }
      return []; // No children for DeltaResult. Yet
    }

    const tree = buildTree();
    this.treeUpdateEmitter.fire(tree);
    return tree;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

function buildTree() {
  // Skip the GitRoot level if there is only one workspace
  if (DeltaAnalyser.instance.analysisResults.size === 1) {
    const analysis = DeltaAnalyser.instance.analysisResults.values().next().value as DeltaAnalysisResult;
    return deltaResultsFromAnalysis(analysis);
  }

  const items: Array<GitRoot | DeltaResult> = [];
  DeltaAnalyser.instance.analysisResults.forEach((value, key) => {
    items.push(new GitRoot(key, value));
  });
  return items;
}

// TODO @jlindbergh Maybe interface DeltaTreeViewItem { label, uri, collapsibleState, children }  ???

class GitRoot {
  readonly label: string;
  readonly collapsibleState: vscode.TreeItemCollapsibleState;
  readonly children: DeltaResult[] = [];
  constructor(workspaceName: string, analysis: DeltaAnalysisResult) {
    this.label = workspaceName.split('/').pop() || 'Unknown';
    this.children = deltaResultsFromAnalysis(analysis);
    this.collapsibleState =
      this.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
  }
}

class DeltaResult {
  readonly result: DeltaForFile | DeltaAnalysisState;
  readonly collapsibleState: vscode.TreeItemCollapsibleState;
  readonly children: DeltaFinding[] = [];
  constructor(result: DeltaForFile | DeltaAnalysisState) {
    this.result = result;
    this.children = findingsFromDelta(result);
    this.collapsibleState =
      this.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
  }

  get label() {
    if (this.result === 'running') {
      return 'Running analysis...';
    } else if (this.result === 'failed') {
      return 'Analysis failed';
    } else {
      const scoreString = `${this.result['old-score'] ? roundScore(this.result['old-score']) : 'n/a'} -> ${roundScore(
        this.result['new-score']
      )}`;

      return `🚩 ${this.result.name} ${scoreString}`;
    }
  }
}

class DeltaFinding {
  constructor(private category: string, private description: string, position: vscode.Position) {}

  get label() {
    return `${this.category}`;
  }
}

function deltaResultsFromAnalysis(analysis: DeltaAnalysisResult) {
  if (typeof analysis === 'string') {
    return [new DeltaResult(analysis)];
  }

  if (analysis.length === 0) return [];

  const items: DeltaResult[] = [];
  analysis.forEach((deltaForFile) => {
    items.push(new DeltaResult(deltaForFile));
  });
  return items;
}

function findingsFromDelta(delta: DeltaForFile | DeltaAnalysisState) {
  if (typeof delta === 'string') return [];

  const deltaFindings = delta.findings.flatMap((finding) =>
    finding['change-details'].flatMap((changeDetail) => {
      if (!changeDetail.locations) {
        return new DeltaFinding(finding.category, changeDetail.description, new vscode.Position(0, 0));
      }

      return changeDetail.locations.map(
        (location) =>
          new DeltaFinding(finding.category, changeDetail.description, new vscode.Position(location['start-line'], 0)) // function-level issues
      );
    })
  );
  return deltaFindings;
}
