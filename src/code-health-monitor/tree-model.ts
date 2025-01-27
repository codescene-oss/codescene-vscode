import vscode from 'vscode';
import { issueToDocsParams } from '../documentation/commands';
import { FnToRefactor } from '../refactoring/capabilities';
import { vscodeRange } from '../review/utils';
import { isDefined, pluralize, round } from '../utils';
import { DeltaAnalysisState } from './analyser';
import { ChangeDetail, DeltaForFile, FunctionInfo, isDegradation, isImprovement, scorePresentation } from './model';
import { toFileWithIssuesUri } from './presentation';

const fgColor = new vscode.ThemeColor('foreground');
export const okColor = new vscode.ThemeColor('terminal.ansiGreen');
const warningColor = new vscode.ThemeColor('editorWarning.foreground');
export const errorColor = new vscode.ThemeColor('errorForeground');

export function issuesCount(tree: Array<DeltaTreeViewItem | DeltaAnalysisState>): number {
  return tree.reduce((prev, curr) => {
    if (typeof curr === 'string') return prev;
    if (curr instanceof DeltaIssue) {
      return prev + (isDegradation(curr.changeDetail['change-type']) ? 1 : 0);
    }
    return prev + (curr.children ? issuesCount(curr.children) : 0);
  }, 0);
}

export function refactoringsCount(tree: Array<DeltaTreeViewItem | DeltaAnalysisState>): number {
  return tree.reduce((prev, curr) => {
    if (typeof curr === 'string') return prev;
    if (curr instanceof DeltaFunctionInfo) {
      return prev + (curr.isRefactoringSupported ? 1 : 0);
    }
    return prev + (curr.children ? refactoringsCount(curr.children) : 0);
  }, 0);
}

export interface DeltaTreeViewItem {
  toTreeItem(): vscode.TreeItem;
  parent?: DeltaTreeViewItem;
  children?: Array<DeltaTreeViewItem>;
}

export class FileWithIssues implements DeltaTreeViewItem {
  public children: Array<DeltaTreeViewItem> = [];

  private codeHealthInfo?: DeltaInfoItem;
  private fileLevelIssues: DeltaIssue[] = [];
  public functionLevelIssues: DeltaFunctionInfo[] = [];

  constructor(public deltaForFile: DeltaForFile, public document: vscode.TextDocument) {
    this.update(deltaForFile, document);
  }

  private createCodeHealthInfo(deltaForFile: DeltaForFile) {
    const scoreLabel = `Code Health: ${scorePresentation(deltaForFile)}`;
    const scoreInfo = new vscode.TreeItem(scoreLabel);
    const exploreText = 'Explore the functions below for more details.';
    const iconAndTooltip = () => {
      if (this.scoreChange > 0) {
        return {
          icon: new vscode.ThemeIcon('arrow-up', okColor),
          tooltip: 'The Code health for this file is improving.',
        };
      } else if (this.scoreChange < 0) {
        return {
          icon: new vscode.ThemeIcon('arrow-down', errorColor),
          tooltip: 'The Code health for this file is declining.',
        };
      } else {
        return {
          icon: new vscode.ThemeIcon('arrow-right', fgColor),
          tooltip: 'The Code health for this file is unchanged.',
        };
      }
    };

    const { icon, tooltip } = iconAndTooltip();
    scoreInfo.tooltip = `${tooltip} ${exploreText}`;
    scoreInfo.iconPath = icon;
    scoreInfo.description = `(${round(this.scorePercentageChange, 2)}%)`;
    return new DeltaInfoItem(scoreInfo);
  }

  get nIssues() {
    return this.fileLevelIssues.length + this.functionLevelIssues.length;
  }

  get nRefactorableFunctions() {
    return this.functionLevelIssues.filter((fn) => fn.isRefactoringSupported).length;
  }

  get scoreChange() {
    const oldScore = this.deltaForFile['old-score'] || 10;
    const newScore = this.deltaForFile['new-score'];
    if (isDefined(newScore)) {
      return newScore - oldScore;
    }
    return 0;
  }

  get scorePercentageChange() {
    const oldScore = this.deltaForFile['old-score'] || 10;
    return (this.scoreChange / oldScore) * 100;
  }

  update(deltaForFile: DeltaForFile, document: vscode.TextDocument) {
    this.deltaForFile = deltaForFile;
    this.document = document;
    this.codeHealthInfo = this.createCodeHealthInfo(deltaForFile);
    this.fileLevelIssues = deltaForFile['file-level-findings'].map((finding) => new DeltaIssue(this, finding));
    this.functionLevelIssues = deltaForFile['function-level-findings'].map((finding) => {
      const functionInfo = new DeltaFunctionInfo(this, finding.function, finding.refactorableFn);
      finding['change-details'].forEach((changeDetail) =>
        functionInfo.children.push(new DeltaIssue(functionInfo, changeDetail))
      );
      return functionInfo;
    });
    this.sortAndSetChildren();
  }

  sortAndSetChildren() {
    this.functionLevelIssues.sort(sortFn);
    // After sorting the fnLevel issues, set the code health info first, then file and lastly the sorted function level issues
    this.children = this.codeHealthInfo ? [this.codeHealthInfo] : [];
    this.children.push(...this.fileLevelIssues, ...this.functionLevelIssues);
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(toFileWithIssuesUri(this.document.uri, this.children), this.collapsedState);
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
  readonly range?: vscode.Range;
  readonly children: Array<DeltaIssue> = [];

  constructor(readonly parent: FileWithIssues, fnMeta: FunctionInfo, public fnToRefactor?: FnToRefactor) {
    this.fnName = fnMeta.name;
    this.range = vscodeRange(fnMeta.range);
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.fnName, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('symbol-function');
    item.description = this.isRefactoringSupported ? 'Auto-Refactor' : undefined;
    item.tooltip = this.tooltip();

    return item;
  }

  private tooltip() {
    const issues = issuesCount(this.children);
    const tips = [`Function "${this.fnName}"`];

    issues && tips.push(`Contains ${issues} ${pluralize('issue', issues)} degrading code health`);
    this.isRefactoringSupported && tips.push('Auto-refactor available');
    return tips.join(' • ');
  }

  public get isRefactoringSupported() {
    return isDefined(this.fnToRefactor);
  }
}

export class DeltaInfoItem implements DeltaTreeViewItem {
  constructor(readonly treeItem: vscode.TreeItem) {}
  toTreeItem(): vscode.TreeItem {
    return this.treeItem;
  }
}

export class DeltaIssue implements DeltaTreeViewItem {
  readonly position?: vscode.Position;

  constructor(readonly parent: DeltaFunctionInfo | FileWithIssues, readonly changeDetail: ChangeDetail) {
    if (changeDetail.position) {
      this.position = new vscode.Position(changeDetail.position.line - 1, changeDetail.position.column - 1);
    }
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.changeDetail.category, vscode.TreeItemCollapsibleState.None);
    item.iconPath = this.iconPath;
    item.tooltip = this.changeDetail.description;
    const fnInfo = this.parent instanceof DeltaFunctionInfo ? this.parent : undefined;
    item.command = {
      command: 'codescene.openInteractiveDocsPanel',
      title: 'Open interactive documentation',
      arguments: [issueToDocsParams(this, fnInfo), 'code-health-tree-view'],
    };
    return item;
  }

  private get iconPath() {
    if (isDegradation(this.changeDetail['change-type'])) {
      return new vscode.ThemeIcon('warning', warningColor);
    } else if (isImprovement(this.changeDetail['change-type'])) {
      return new vscode.ThemeIcon('pass', okColor);
    }
    return undefined;
  }

  get parentDocument() {
    return this.parent instanceof DeltaFunctionInfo ? this.parent.parent.document : this.parent.document;
  }
}

/**
 * Sort function level issues by refactorability, then by line number.
 */
export function sortFn(a: DeltaFunctionInfo, b: DeltaFunctionInfo) {
  // If one of the items has an undefined range, sort it last (functions with fixed issues might have null range)
  if (!a.range) return 1;
  if (!b.range) return -1;
  // Refactorability first
  const aRef = a.isRefactoringSupported ? -1 : 1;
  const bRef = b.isRefactoringSupported ? -1 : 1;
  if (aRef !== bRef) return aRef - bRef;

  // ...then by line number
  return a.range.start.line - b.range.start.line;
}
