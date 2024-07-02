import path from 'path';
import vscode from 'vscode';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import { roundScore } from '../review/utils';
import { DeltaAnalysisState } from './analyser';
import { ChangeDetails, DeltaForFile, Location, getStartLine, isDegradation, isImprovement } from './model';
import { toDeltaAnalysisUri, toDeltaFunctionUri } from './presentation';

export function countIssuesIn(tree: Array<DeltaTreeViewItem | DeltaAnalysisState>): number {
  return tree.reduce((prev, curr) => {
    if (typeof curr === 'string') return prev;
    if (curr instanceof DeltaIssue) {
      return prev + (isDegradation(curr.changeDetails['change-type']) ? 1 : 0);
    }
    return prev + (curr.children ? countIssuesIn(curr.children) : 0);
  }, 0);
}

export function refactoringsInTree(tree: Array<DeltaTreeViewItem | DeltaAnalysisState>): number {
  return tree.reduce((prev, curr) => {
    if (typeof curr === 'string') return prev;
    if (curr instanceof DeltaFunctionInfo) {
      return prev + (curr.refactoring ? 1 : 0);
    }
    return prev + (curr.children ? refactoringsInTree(curr.children) : 0);
  }, 0);
}

export function filesWithIssuesInTree(tree: Array<DeltaTreeViewItem | DeltaAnalysisState>): FileWithIssues[] {
  const deltaResults: FileWithIssues[] = [];
  tree.forEach((item) => {
    if (item instanceof FileWithIssues) {
      deltaResults.push(item);
      return;
    }
  });
  return deltaResults;
}

export interface DeltaTreeViewItem {
  toTreeItem(): vscode.TreeItem;
  children?: Array<DeltaTreeViewItem | DeltaAnalysisState>;
}

export class FileWithIssues implements DeltaTreeViewItem {
  public children: Array<DeltaFunctionInfo | DeltaIssue> = [];
  constructor(readonly result: DeltaForFile, readonly uri: vscode.Uri) {
    this.updateChildren(result);
  }

  updateChildren(deltaAnalysis: DeltaForFile) {
    this.children = fileAndFunctionLevelIssues(this, deltaAnalysis);
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(toDeltaAnalysisUri(this.uri, this.children), this.collapsedState);
    item.label = this.label;
    return item;
  }

  private get label() {
    const scoreString = `${this.result['old-score'] ? roundScore(this.result['old-score']) : 'n/a'} → ${roundScore(
      this.result['new-score']
    )}`;
    const fileName = path.basename(this.result.name);
    return `${fileName} ${scoreString}`;
  }

  private get collapsedState() {
    if (this.children.length === 0) return vscode.TreeItemCollapsibleState.None;
    if (this.children.length < 5) return vscode.TreeItemCollapsibleState.Expanded;
    return vscode.TreeItemCollapsibleState.Collapsed;
  }
}

export class DeltaFunctionInfo implements DeltaTreeViewItem {
  readonly fnName: string;
  readonly position: vscode.Position;
  readonly children: DeltaIssue[] = [];

  constructor(readonly parent: FileWithIssues, location: Location, public refactoring?: CsRefactoringRequest) {
    this.fnName = location.function;
    this.position = locationToPos(location);
  }

  toTreeItem(): vscode.TreeItem {
    const issues = countIssuesIn(this.children);
    const item = new vscode.TreeItem(toDeltaFunctionUri(issues), vscode.TreeItemCollapsibleState.Collapsed);
    item.label = this.fnName;
    item.iconPath = new vscode.ThemeIcon('symbol-function');
    item.tooltip = `Function ${this.fnName}`;
    item.command = this.command;

    if (this.refactoring) {
      this.presentAsLoadingRefactoring(item);
      this.refactoring.promise.then(
        () => {
          this.refactoring?.shouldPresent() ? this.presentAsRefactorable(item, issues) : (item.description = undefined);
        },
        () => (item.description = undefined)
      );
    }

    return item;
  }

  private get command() {
    const uri = this.parent.uri;
    const location = new vscode.Location(uri, this.position);
    return {
      command: 'editor.action.goToLocations',
      title: 'Go to location',
      arguments: [uri, this.position, [location]],
    };
  }

  private presentAsLoadingRefactoring(item: vscode.TreeItem) {
    item.description = 'Attempting refactoring...';
  }

  private presentAsRefactorable(item: vscode.TreeItem, issues: number) {
    item.resourceUri = toDeltaFunctionUri(issues, true);
    item.description = 'Auto-refactor available';
    item.contextValue = 'delta-refactorableFunction';
  }
}

export class DeltaIssue implements DeltaTreeViewItem {
  readonly position: vscode.Position;

  constructor(
    readonly parent: DeltaFunctionInfo | FileWithIssues,
    readonly category: string,
    readonly changeDetails: ChangeDetails,
    location?: Location
  ) {
    this.position = locationToPos(location);
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.category, vscode.TreeItemCollapsibleState.None);
    item.iconPath = this.iconPath;
    item.command = this.command;
    item.tooltip = this.changeDetails.description;
    item.contextValue = isDegradation(this.changeDetails['change-type']) ? 'delta-degradation' : 'delta-improvement';
    return item;
  }

  private get command() {
    const uri = this.parentUri;
    const location = new vscode.Location(uri, this.position);
    return {
      command: 'editor.action.goToLocations',
      title: 'Go to location',
      arguments: [uri, this.position, [location]],
    };
  }

  private get iconPath() {
    if (isDegradation(this.changeDetails['change-type'])) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('codescene.codeHealth.unhealthy'));
    } else if (isImprovement(this.changeDetails['change-type'])) {
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('codescene.codeHealth.healthy'));
    }
    return undefined;
  }

  get parentUri() {
    return this.parent instanceof DeltaFunctionInfo ? this.parent.parent.uri : this.parent.uri;
  }
}

function capitalizeFirstLetter(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fileAndFunctionLevelIssues(
  parent: FileWithIssues,
  delta: DeltaForFile
): Array<DeltaFunctionInfo | DeltaIssue> {
  const functions: Map<string, DeltaFunctionInfo> = new Map();
  const fileLevelIssues: DeltaIssue[] = [];
  delta.findings.forEach((finding) => {
    // Find all functions with locations and create DeltaFunctionInfo for them
    finding['change-details'].forEach((changeDetail) => {
      // File level issues
      if (!changeDetail.locations) {
        fileLevelIssues.push(new DeltaIssue(parent, finding.category, changeDetail));
        return;
      }

      // Function "locations" might be nested under several different "findings"
      // We'll save them in a map to easily retreive them before adding the DeltaIssues
      changeDetail.locations.forEach((location) => {
        const key = location.function;
        let fnInfo = functions.get(key);
        if (!fnInfo) {
          fnInfo = new DeltaFunctionInfo(parent, location, refactoringFromLocation(location, delta.refactorings));
          functions.set(key, fnInfo);
        }

        fnInfo.children.push(new DeltaIssue(fnInfo, finding.category, changeDetail, location));
      });
    });
  });

  // Collect all values in the functions map and sort them by line number
  const functionLevelIssues = Array.from(functions.values()).sort((a, b) => a.position.line - b.position.line);
  // Then sort their children on Improvement status
  functionLevelIssues.forEach((fnInfo) => {
    fnInfo.children.sort(
      (a, b) =>
        Number(isImprovement(a.changeDetails['change-type'])) - Number(isImprovement(b.changeDetails['change-type']))
    );
  });

  return [...fileLevelIssues, ...functionLevelIssues];
}

function refactoringFromLocation(location: Location, refactorings?: CsRefactoringRequest[]) {
  if (!refactorings) return;
  return refactorings.find(
    (refactoring) =>
      refactoring.fnToRefactor.name === location.function &&
      refactoring.fnToRefactor.range.start.line === getStartLine(location) - 1
  );
}

function locationToPos(location?: Location) {
  return location ? new vscode.Position(getStartLine(location) - 1, 0) : new vscode.Position(0, 0);
}
