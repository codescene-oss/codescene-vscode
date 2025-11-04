import vscode from 'vscode';
import { ChangeDetail } from '../devtools-api/delta-model';
import { issueToDocsParams } from '../documentation/commands';
import { isDegradation, errorColor, okColor } from './presentation';
import { DeltaTreeViewItem } from './tree-model';
import { DeltaFunctionInfo } from './delta-function-info';
import { FileWithIssues } from './file-with-issues';

const warningColor = new vscode.ThemeColor('editorWarning.foreground');

export class DeltaIssue implements DeltaTreeViewItem {
  readonly position?: vscode.Position;

  constructor(readonly parent: DeltaFunctionInfo | FileWithIssues, readonly changeDetail: ChangeDetail) {
    if (changeDetail.line) {
      this.position = new vscode.Position(changeDetail.line - 1, 0);
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
    if (isDegradation(this.changeDetail['change-type'])) return new vscode.ThemeIcon('chrome-close', errorColor);
    if (this.changeDetail['change-type'] === 'improved') return new vscode.ThemeIcon('arrow-up', warningColor);
    if (this.changeDetail['change-type'] === 'fixed') return new vscode.ThemeIcon('check', okColor);

    return undefined;
  }

  get parentDocument() {
    return this.parent instanceof DeltaFunctionInfo ? this.parent.parent.document : this.parent.document;
  }
}
