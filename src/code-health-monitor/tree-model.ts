import vscode from 'vscode';
import { ChangeType } from '../devtools-api/delta-model';
import { DeltaIssue } from './delta-issue';
import { DeltaFunctionInfo } from './delta-function-info';

export { FileWithIssues } from './file-with-issues';
export { DeltaFunctionInfo } from './delta-function-info';
export { DeltaInfoItem } from './delta-info-item';
export { DeltaIssue } from './delta-issue';
export { sortFnInfo, sortIssues } from './sort-fn-info';

export function countInTree(tree: Array<DeltaTreeViewItem>, fn: (item: ChangeType) => boolean): number {
  return tree.reduce((prev, curr) => {
    if (typeof curr === 'string') return prev;
    if (curr instanceof DeltaIssue) {
      return prev + (fn(curr.changeDetail['change-type']) ? 1 : 0);
    }
    return prev + (curr.children ? countInTree(curr.children, fn) : 0);
  }, 0);
}

export function refactoringsCount(tree: Array<DeltaTreeViewItem>): number {
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

