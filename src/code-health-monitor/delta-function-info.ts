import vscode from 'vscode';
import { CodeSmell } from '../devtools-api/review-model';
import { vscodeRange } from '../review/utils';
import { isDefined, pluralize } from '../utils';
import { isDegradation, okColor, errorColor } from './presentation';
import { DeltaTreeViewItem, countInTree } from './tree-model';
import { FileWithIssues } from './file-with-issues';
import { DeltaIssue } from './delta-issue';
import { Function, ChangeType } from '../devtools-api/delta-model';
import { logOutputChannel } from '../log';

const warningColor = new vscode.ThemeColor('editorWarning.foreground');

export class DeltaFunctionInfo implements DeltaTreeViewItem {
  readonly fnName: string;
  readonly range?: vscode.Range;
  readonly children: Array<DeltaIssue> = [];

  constructor(readonly parent: FileWithIssues, fnMeta: Function, public codeSmell?: CodeSmell) {
    this.fnName = fnMeta.name;
    this.range = vscodeRange(fnMeta.range);
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.fnName, vscode.TreeItemCollapsibleState.None);
    item.iconPath = this.iconPath;
    item.description = this.isRefactoringSupported ? 'Auto-Refactor' : undefined;
    item.tooltip = this.tooltip();

    return item;
  }

  get iconPath() {
    if (this.children.every((issue) => issue.changeDetail['change-type'] === 'fixed')) {
      return new vscode.ThemeIcon('symbol-function', okColor);
    }
    if (this.children.every((issue) => isDegradation(issue.changeDetail['change-type']))) {
      return new vscode.ThemeIcon('symbol-function', errorColor);
    }
    return new vscode.ThemeIcon('symbol-function', warningColor);
  }

  private tooltip() {
    const tips = [`Function "${this.fnName}"`];

    const issues = countInTree(this.children, isDegradation);
    issues && tips.push(`${issues} ${pluralize('issue', issues)} degrading code health`);

    const improvements = countInTree(this.children, (t: ChangeType) => t === 'improved');
    improvements && tips.push(`${improvements} ${pluralize('issue', issues)} with room for improvement`);

    const fixed = countInTree(this.children, (t: ChangeType) => t === 'fixed');
    fixed && tips.push(`${fixed} ${pluralize('issue', issues)} fixed`);

    this.isRefactoringSupported && tips.push('Auto-refactor available');

    return tips.join(' • ');
  }

  public get isRefactoringSupported() {
    return isDefined(this.codeSmell);
  }
}
