import vscode from 'vscode';
import { round } from '../utils';
import { scorePresentation, toFileWithIssuesUri, okColor, errorColor } from './presentation';
import { DeltaTreeViewItem } from './tree-model';
import { DeltaInfoItem } from './delta-info-item';
import { DeltaIssue } from './delta-issue';
import { DeltaFunctionInfo } from './delta-function-info';
import { sortFnInfo } from './sort-fn-info';
import { Delta } from '../devtools-api/delta-model';

const fgColor = new vscode.ThemeColor('foreground');

export class FileWithIssues implements DeltaTreeViewItem {
  public children: Array<DeltaTreeViewItem> = [];

  private codeHealthInfo?: DeltaInfoItem;
  private fileLevelIssues: DeltaIssue[] = [];
  public functionLevelIssues: DeltaFunctionInfo[] = [];

  constructor(public deltaForFile: Delta, public document: vscode.TextDocument) {
    this.update(deltaForFile, document);
  }

  private createCodeHealthInfo(deltaForFile: Delta) {
    const scoreLabel = `Code Health: ${scorePresentation(deltaForFile)}`;
    const scoreInfo = new vscode.TreeItem(scoreLabel);
    const exploreText = 'Explore the functions below for more details.';
    const iconAndTooltip = () => {
      if (this.scoreChange > 0) {
        return {
          icon: new vscode.ThemeIcon('pulse', okColor),
          tooltip: 'Code Health for this file is improving.',
        };
      } else if (this.scoreChange < 0) {
        return {
          icon: new vscode.ThemeIcon('pulse', errorColor),
          tooltip: 'Code Health for this file is declining.',
        };
      } else {
        return {
          icon: new vscode.ThemeIcon('pulse', fgColor),
          tooltip: 'Code Health for this file is unchanged.',
        };
      }
    };

    const { icon, tooltip } = iconAndTooltip();
    const percentageChange = round(this.scorePercentageChange, 2);

    scoreInfo.tooltip = `${tooltip} ${exploreText}`;
    scoreInfo.iconPath = icon;
    if (percentageChange !== 0) scoreInfo.description = `(${percentageChange}%)`;

    return new DeltaInfoItem(scoreInfo);
  }

  get nIssues() {
    return this.fileLevelIssues.length + this.functionLevelIssues.length;
  }

  get nRefactorableFunctions() {
    return this.functionLevelIssues.filter((fn) => fn.isRefactoringSupported).length;
  }

  get scoreChange() {
    return this.deltaForFile['score-change'];
  }

  get scorePercentageChange() {
    const oldScore = this.deltaForFile['old-score'] || 10;
    return (this.scoreChange / oldScore) * 100;
  }

  update(deltaForFile: Delta, document: vscode.TextDocument) {
    this.deltaForFile = deltaForFile;
    this.document = document;
    this.codeHealthInfo = this.createCodeHealthInfo(deltaForFile);
    // Remove these from the tree, and show in file level details view later
    // this.fileLevelIssues = deltaForFile['file-level-findings'].map((finding) => new DeltaIssue(this, finding));
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
    this.functionLevelIssues.sort(sortFnInfo);
    // After sorting the fnLevel issues, set the code health info first, then file and lastly the sorted function level issues
    this.children = this.codeHealthInfo ? [this.codeHealthInfo] : [];
    this.children.push(...this.fileLevelIssues, ...this.functionLevelIssues);
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(toFileWithIssuesUri(this.document.uri, this.children), this.collapsedState);
    const percentageChange = round(this.scorePercentageChange, 2);

    item.iconPath = vscode.ThemeIcon.File;
    if (percentageChange !== 0) item.description = `${percentageChange}%`;

    return item;
  }

  private get collapsedState() {
    if (this.children.length === 0) return vscode.TreeItemCollapsibleState.None;
    if (this.children.length < 5) return vscode.TreeItemCollapsibleState.Expanded;
    return vscode.TreeItemCollapsibleState.Collapsed;
  }
}
