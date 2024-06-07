import path from 'path';
import vscode from 'vscode';
import { roundScore } from '../review/utils';
import { DeltaAnalyser, DeltaAnalysisResult, DeltaAnalysisState } from './analyser';
import { ChangeDetails, ChangeType, DeltaForFile, Location, toStartLineNumber, isDegradation, isImprovement, toAbsoluteUri } from './model';
import { toCsAnalysisUri } from './presentation';

export function issuesInFiles(items: Array<FileWithChanges | DeltaFinding>): number {
  return items.reduce((prev, curr) => {
    if (curr instanceof DeltaFinding) {
      if (isDegradation(curr.changeType)) {
        return prev + 1; // Count Findings with degradations
      }
      return prev;
    }
    return prev + issuesInFiles(curr.children); // Recurse into DeltaFindings
  }, 0);
}

export function resultsInTree(items: Array<GitRoot | FileWithChanges | DeltaAnalysisState>): FileWithChanges[] {
  const deltaResults: FileWithChanges[] = [];
  items.forEach((item) => {
    if (typeof item === 'string') return; // Skip DeltaAnalysisState
    if (item instanceof FileWithChanges) {
      deltaResults.push(item);
      return;
    }
    deltaResults.push(...resultsInTree(item.children));
  });
  return deltaResults;
}

interface DeltaTreeViewItem {
  toTreeItem(): vscode.TreeItem;
}

export function buildTree(): Array<GitRoot | FileWithChanges | DeltaAnalysisState> {
  // Skip the GitRoot level if there's only one workspace
  if (DeltaAnalyser.instance.analysisResults.size === 1) {
    const [rootPath, analysis] = DeltaAnalyser.instance.analysisResults.entries().next().value;
    return gitRootChildren(analysis, new GitRoot(rootPath, analysis));
  }

  const items: Array<GitRoot | FileWithChanges> = [];
  DeltaAnalyser.instance.analysisResults.forEach((value, key) => {
    items.push(new GitRoot(key, value));
  });
  return items;
}

function gitRootChildren(analysis: DeltaAnalysisResult, parent: GitRoot): Array<FileWithChanges | DeltaAnalysisState> {
  if (typeof analysis === 'string') {
    return [analysis];
  }

  if (analysis.length === 0) return [];

  const items: FileWithChanges[] = [];
  analysis.forEach((deltaForFile) => {
    items.push(new FileWithChanges(deltaForFile, parent));
  });
  return items.sort((a, b) => a.uri.path.localeCompare(b.uri.path));
}

export class GitRoot implements DeltaTreeViewItem {
  readonly children: Array<FileWithChanges | DeltaAnalysisState> = [];
  constructor(readonly rootPath: string, analysis: DeltaAnalysisResult) {
    this.children = gitRootChildren(analysis, this);
  }

  toTreeItem(): vscode.TreeItem {
    return new vscode.TreeItem(
      this.rootPath.split('/').pop() || 'Unknown',
      this.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
  }
}

export class FileWithChanges implements DeltaTreeViewItem {
  readonly children: DeltaFinding[] = [];
  readonly uri: vscode.Uri;
  constructor(readonly result: DeltaForFile, readonly parent: GitRoot) {
    this.uri = toAbsoluteUri(parent.rootPath, result.name);
    this.children = findingsFromDelta(this, result);
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      toCsAnalysisUri(this.uri, issuesInFiles(this.children)),
      this.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );

    const scoreString = `${this.result['old-score'] ? roundScore(this.result['old-score']) : 'n/a'} -> ${roundScore(
      this.result['new-score']
    )}`;
    const fileName = path.basename(this.result.name);
    item.label = `${fileName} ${scoreString}`;
    item.contextValue = 'fileWithChanges';
    return item;
  }
}

export class DeltaFinding implements DeltaTreeViewItem {
  private fnName?: string;
  private description: string;
  readonly position: vscode.Position;
  readonly changeType: ChangeType;

  constructor(
    readonly parent: FileWithChanges,
    private category: string,
    changeDetails: ChangeDetails,
    location?: Location
  ) {
    this.fnName = location?.function;
    this.position = location ? new vscode.Position(toStartLineNumber(location), 0) : new vscode.Position(0, 0);
    this.description = changeDetails.description;
    this.changeType = changeDetails['change-type'];
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label(), vscode.TreeItemCollapsibleState.None);

    let statusText = '';
    if (isDegradation(this.changeType)) {
      statusText = 'Degradation';
      item.iconPath = new vscode.ThemeIcon('close', new vscode.ThemeColor('errorForeground'));
    } else if (isImprovement(this.changeType)) {
      statusText = 'Improvement';
      item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('iconForeground')); // testing.iconPassed (green)
    }
    item.tooltip = `${statusText} • ${this.description}`;

    if (this.supportsRefactoring()) {
      item.contextValue = 'deltaFindingRefactorable';
    } else {
      item.contextValue = 'deltaFinding';
    }
    return item;
  }

  // TODO - implement support for filtering DeltaFindings based on preflight response
  private supportsRefactoring() {
    return false;
  }

  private label() {
    if (this.fnName) {
      return `Function '${this.fnName}'`;
    }
    return `${this.category}`;
  }
}

function findingsFromDelta(parent: FileWithChanges, delta: DeltaForFile) {
  const deltaFindings = delta.findings.flatMap((finding) =>
    finding['change-details'].flatMap((changeDetail) => {
      if (!changeDetail.locations) {
        return new DeltaFinding(parent, finding.category, changeDetail);
      }

      return changeDetail.locations.map(
        (location) => new DeltaFinding(parent, finding.category, changeDetail, location) // function-level issues
      );
    })
  );
  return deltaFindings.sort((a, b) => a.position.line - b.position.line);
}
