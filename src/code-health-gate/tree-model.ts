import path from 'path';
import vscode from 'vscode';
import { CsRefactoringRequest, ResolvedRefactoring } from '../refactoring/cs-refactoring-requests';
import { roundScore } from '../review/utils';
import { DeltaAnalyser, DeltaAnalysisResult, DeltaAnalysisState } from './analyser';
import {
  ChangeDetails,
  ChangeType,
  DeltaForFile,
  Location,
  isDegradation,
  isImprovement,
  toAbsoluteUri,
  getStartLine,
} from './model';
import { toDeltaAnalysisUri, toDeltaIssueUri } from './presentation';

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

export interface AceRequests {
  refactoring: ResolvedRefactoring;
  requests: CsRefactoringRequest[];
}

export function buildTree(refactoringInfo?: AceRequests): Array<GitRoot | FileWithChanges | DeltaAnalysisState> {
  // Skip the GitRoot level if there's only one workspace
  if (DeltaAnalyser.instance.analysisResults.size === 1) {
    const [rootPath, analysis] = DeltaAnalyser.instance.analysisResults.entries().next().value as [
      string,
      DeltaAnalysisResult
    ];
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

  if (analysis.length === 0) return ['no-issues-found'];

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
    const item = new vscode.TreeItem(toDeltaAnalysisUri(this.uri, this.children), this.collapsedState);

    const scoreString = `${this.result['old-score'] ? roundScore(this.result['old-score']) : 'n/a'} -> ${roundScore(
      this.result['new-score']
    )}`;
    const fileName = path.basename(this.result.name);
    item.label = `${fileName} ${scoreString}`;
    item.contextValue = 'fileWithChanges';
    return item;
  }

  private get collapsedState() {
    if (this.children.length === 0) return vscode.TreeItemCollapsibleState.None;
    if (this.children.length < 5) return vscode.TreeItemCollapsibleState.Expanded;
    return vscode.TreeItemCollapsibleState.Collapsed;
  }
}

export class DeltaFinding implements DeltaTreeViewItem {
  private description: string;
  readonly fnName?: string;
  readonly position: vscode.Position;
  readonly changeType: ChangeType;
  refactorable = false;

  constructor(
    readonly parent: FileWithChanges,
    private category: string,
    changeDetails: ChangeDetails,
    location?: Location,
    readonly refactoring?: CsRefactoringRequest
  ) {
    this.fnName = location?.function;
    this.position = locationToPos(location);
    this.description = changeDetails.description;
    this.changeType = changeDetails['change-type'];
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(toDeltaIssueUri(this), vscode.TreeItemCollapsibleState.None);
    item.label = this.label;
    item.iconPath = this.iconPath;
    item.tooltip = `${capitalizeFirstLetter(this.changeType)} ${this.category} • ${this.description}`;
    item.contextValue = 'deltaFinding';
    this.refactoring?.promise?.then(() => {
      this.refactoring?.shouldPresent() && this.presentAsRefactorable(item);
    }, undefined);

    item.command = this.command;
    return item;
  }

  private presentAsRefactorable(item: vscode.TreeItem) {
    this.refactorable = true;
    item.resourceUri = toDeltaIssueUri(this, true);
    item.description = 'Refactoring available';
    item.contextValue = 'deltaFindingRefactorable';
  }

  private get command() {
    const uri = this.parent.uri;
    const position = this.position;
    const location = new vscode.Location(uri, position);
    return {
      command: 'editor.action.goToLocations',
      title: 'Go to location',
      arguments: [uri, position, [location]],
    };
    // void vscode.commands.executeCommand('editor.action.goToLocations', uri, position, [location]);
  }

  private get iconPath() {
    if (isDegradation(this.changeType)) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('codescene.codeHealth.unhealthy'));
    } else if (isImprovement(this.changeType)) {
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('codescene.codeHealth.healthy'));
    }
    return undefined;
  }

  private get label() {
    if (this.fnName) {
      return `${this.fnName}`;
    }
    return `${this.category}`;
  }
}

function capitalizeFirstLetter(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function findingsFromDelta(parent: FileWithChanges, delta: DeltaForFile) {
  const deltaFindings = delta.findings.flatMap((finding) =>
    finding['change-details'].flatMap((changeDetail) => {
      if (!changeDetail.locations) {
        return new DeltaFinding(parent, finding.category, changeDetail);
      }

      // function-level issues
      return changeDetail.locations.map((location) => {
        const refactoring = refactoringFromLocation(location, delta.refactorings);
        return new DeltaFinding(parent, finding.category, changeDetail, location, refactoring);
      });
    })
  );
  return deltaFindings
    .sort((a, b) => a.position.line - b.position.line)
    .sort((a, b) => Number(isImprovement(a.changeType)) - Number(isImprovement(b.changeType)));
}

function refactoringFromLocation(location: Location, refactorings?: CsRefactoringRequest[]) {
  if (!refactorings) return;
  return refactorings.find(
    (refactoring) =>
      refactoring.fnToRefactor.name === location.function &&
      refactoring.fnToRefactor.range.contains(locationToPos(location))
  );
}

function locationToPos(location?: Location) {
  return location ? new vscode.Position(getStartLine(location) - 1, 0) : new vscode.Position(0, 0);
}
