import * as vscode from 'vscode';
import { DeltaFunctionInfo, DeltaIssue } from '../code-health-monitor/tree-model';
import { CodeSceneTabPanel } from '../codescene-tab/webViewPanel';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import { registerCommandWithTelemetry } from '../utils';

export function register(context: vscode.ExtensionContext) {
  const openInteractiveDocsPanel = registerCommandWithTelemetry({
    commandId: 'codescene.openInteractiveDocsPanel',
    handler: (params) => {
      CodeSceneTabPanel.show({ params });
    },
    logArgs: (params: InteractiveDocsParams) => ({ category: params.issueInfo.category }),
  });

  const openCodeHealthDocsCmd = registerCommandWithTelemetry({
    commandId: 'codescene.openCodeHealthDocs',
    handler: () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://codescene.io/docs/guides/technical/code-health.html'));
    },
  });

  context.subscriptions.push(openInteractiveDocsPanel, openCodeHealthDocsCmd);
}

export interface IssueInfo {
  category: string;
  position: vscode.Position;
  fnName?: string;
}

export interface InteractiveDocsParams {
  issueInfo: IssueInfo;
  documentUri: vscode.Uri;
  request?: CsRefactoringRequest;
}

export function issueToDocsParams(issue: DeltaIssue, fnInfo?: DeltaFunctionInfo) {
  const params = toDocsParams(issue.changeDetail.category, issue.position, issue.parentUri);
  params.issueInfo.fnName = fnInfo?.fnName;
  params.request = fnInfo?.refactoring;
  return params;
}

export function toDocsParams(
  category: string,
  position: vscode.Position,
  documentUri: vscode.Uri
): InteractiveDocsParams {
  return { issueInfo: { category, position }, documentUri };
}

export function categoryToDocsCode(issueCategory: string) {
  return issueCategory.replace(/ /g, '-').replace(/,/g, '').toLowerCase();
}
