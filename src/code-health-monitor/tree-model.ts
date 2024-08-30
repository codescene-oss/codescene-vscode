import path from 'path';
import vscode from 'vscode';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import { roundScore } from '../review/utils';
import { pluralize } from '../utils';
import { DeltaAnalysisState } from './analyser';
import { ChangeDetails, DeltaForFile, Location, getStartLine, isDegradation, isImprovement } from './model';
import { toFileWithIssuesUri } from './presentation';
import { error } from 'console';

const fgColor = new vscode.ThemeColor('foreground');
const okColor = new vscode.ThemeColor('terminal.ansiGreen');
const warningColor = new vscode.ThemeColor('editorWarning.foreground');
export const errorColor = new vscode.ThemeColor('errorForeground');

export function issuesCount(tree: Array<DeltaTreeViewItem | DeltaAnalysisState>): number {
  return tree.reduce((prev, curr) => {
    if (typeof curr === 'string') return prev;
    if (curr instanceof DeltaIssue) {
      return prev + (isDegradation(curr.changeDetails['change-type']) ? 1 : 0);
    }
    return prev + (curr.children ? issuesCount(curr.children) : 0);
  }, 0);
}

export function refactoringsCount(tree: Array<DeltaTreeViewItem | DeltaAnalysisState>): number {
  return tree.reduce((prev, curr) => {
    if (typeof curr === 'string') return prev;
    if (curr instanceof DeltaFunctionInfo) {
      return prev + (curr.refactoring?.shouldPresent() ? 1 : 0);
    }
    return prev + (curr.children ? refactoringsCount(curr.children) : 0);
  }, 0);
}

export interface DeltaTreeViewItem {
  toTreeItem(): vscode.TreeItem;
  children?: Array<DeltaTreeViewItem>;
}

export class FileWithIssues implements DeltaTreeViewItem {
  public children: Array<DeltaTreeViewItem> = [];

  private codeHealthInfo?: DeltaInfoItem;
  private fileLevelIssues: DeltaIssue[] = [];
  public functionLevelIssues: DeltaFunctionInfo[] = [];

  constructor(readonly deltaForFile: DeltaForFile, readonly uri: vscode.Uri) {
    this.updateChildren(deltaForFile);
  }

  private createCodeHealthInfo(deltaForFile: DeltaForFile) {
    const scoreLabel = `Code Health: ${
      deltaForFile['old-score'] ? roundScore(deltaForFile['old-score']) : 'n/a'
    } → ${roundScore(deltaForFile['new-score'])}`;
    const scoreInfo = new vscode.TreeItem(scoreLabel);
    scoreInfo.tooltip = 'The Code health for this file is declining. Explore the functions below for more details.';

    const iconByScore = (score: number) => {
      if (score >= 9) {
        return new vscode.ThemeIcon('info', okColor);
      } else if (score >= 4) {
        return new vscode.ThemeIcon('warning', warningColor);
      } else if (score >= 1) {
        return new vscode.ThemeIcon('warning', errorColor);
      }
    };

    scoreInfo.iconPath = iconByScore(deltaForFile['new-score']);
    return new DeltaInfoItem(scoreInfo);
  }

  updateChildren(deltaForFile: DeltaForFile) {
    this.codeHealthInfo = this.createCodeHealthInfo(deltaForFile);

    const functions: Map<string, DeltaFunctionInfo> = new Map();
    this.fileLevelIssues = [];
    deltaForFile.findings.forEach((finding) => {
      // Find all functions with locations and create DeltaFunctionInfo for them
      finding['change-details'].forEach((changeDetail) => {
        // File level issues
        if (!changeDetail.locations) {
          this.fileLevelIssues.push(new DeltaIssue(this, finding.category, changeDetail));
          return;
        }

        // Function "locations" might be nested under several different "findings"
        // We'll save them in a map to easily retreive them before adding the DeltaIssues
        changeDetail.locations.forEach((location) => {
          const key = location.function;
          let fnInfo = functions.get(key);
          if (!fnInfo) {
            fnInfo = new DeltaFunctionInfo(
              this,
              location,
              refactoringFromLocation(location, deltaForFile.refactorings)
            );
            functions.set(key, fnInfo);
          }

          fnInfo.children.push(new DeltaIssue(fnInfo, finding.category, changeDetail, location));
        });
      });
    });

    // Collect all values in the functions map and sort them by line number, then refactorability
    this.functionLevelIssues = Array.from(functions.values());

    this.sortAndSetChildren();
  }

  sortAndSetChildren() {
    this.functionLevelIssues
      .sort((a, b) => a.position.line - b.position.line)
      .sort((a, b) => (a.refactoring?.shouldPresent() ? -1 : 1));

    this.children = this.codeHealthInfo ? [this.codeHealthInfo] : [];
    this.children.push(...this.fileLevelIssues, ...this.functionLevelIssues);
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(toFileWithIssuesUri(this.uri, this.children), this.collapsedState);
    item.iconPath = vscode.ThemeIcon.File;
    return item;
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
  readonly children: Array<DeltaTreeViewItem> = [];

  constructor(readonly parent: FileWithIssues, readonly location: Location, public refactoring?: CsRefactoringRequest) {
    this.fnName = location.function;
    this.position = locationToPos(location);
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.fnName, vscode.TreeItemCollapsibleState.None);
    this.presentAsDefault(item);

    if (this.refactoring) {
      if (this.refactoring.isPending()) {
        this.presentAsLoadingRefactoring(item);
      }
      this.refactoring.promise.then(
        () => {
          this.refactoring?.actionable() ? this.presentAsRefactorable(item) : this.presentAsDefault(item);
        },
        () => this.presentAsDefault(item)
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

  private tooltip(refactorable?: boolean) {
    const issues = issuesCount(this.children);
    const tips = [`Function "${this.fnName}"`];

    issues && tips.push(`Contains ${issues} ${pluralize('issue', issues)} degrading code health`);
    refactorable && tips.push('Auto-refactor available');
    return tips.join(' • ');
  }

  private presentAsDefault(item: vscode.TreeItem) {
    item.iconPath = new vscode.ThemeIcon('symbol-function', fgColor);
    item.tooltip = this.tooltip();
    item.command = this.command;
  }

  private presentAsLoadingRefactoring(item: vscode.TreeItem) {
    item.iconPath = new vscode.ThemeIcon('loading~spin');
  }

  private presentAsRefactorable(item: vscode.TreeItem) {
    item.tooltip = this.tooltip(true);
    item.contextValue = 'delta-refactorableFunction';
    item.iconPath = new vscode.ThemeIcon('sparkle');
  }
}

export class DeltaInfoItem implements DeltaTreeViewItem {
  constructor(readonly treeItem: vscode.TreeItem) {}
  toTreeItem(): vscode.TreeItem {
    return this.treeItem;
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
      return new vscode.ThemeIcon('warning', warningColor);
    } else if (isImprovement(this.changeDetails['change-type'])) {
      return new vscode.ThemeIcon('pass', okColor);
    }
    return undefined;
  }

  get parentUri() {
    return this.parent instanceof DeltaFunctionInfo ? this.parent.parent.uri : this.parent.uri;
  }
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
