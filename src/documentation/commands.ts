import * as vscode from 'vscode';
import { DeltaFunctionInfo, DeltaIssue } from '../code-health-monitor/tree-model';
import { CodeSceneTabPanel } from '../codescene-tab/webview-panel';
import { FnToRefactor } from '../refactoring/capabilities';
import { registerCommandWithTelemetry } from '../utils';

export function register(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    registerCommandWithTelemetry({
      commandId: 'codescene.openInteractiveDocsPanel',
      handler: (params) => {
        CodeSceneTabPanel.show({ params });
      },
      logArgs: (params: InteractiveDocsParams) => ({ category: params.issueInfo.category }),
    }),
    registerCommandWithTelemetry({
      // A query param friendly version of openInteractiveDocsPanel
      commandId: 'codescene.openInteractiveDocsFromDiagnosticTarget',
      handler: async (queryParams) => {
        const { category, lineNo, charNo, documentUri } = queryParams;
        const params: InteractiveDocsParams = {
          issueInfo: { category, position: new vscode.Position(lineNo, charNo) },
          document: await findOrOpenDocument(documentUri),
        };
        CodeSceneTabPanel.show({ params });
      },
      logArgs: (queryParams: any) => ({ category: queryParams.category }),
    }),
    registerCommandWithTelemetry({
      commandId: 'codescene.openCodeHealthDocs',
      handler: () => {
        void vscode.env.openExternal(vscode.Uri.parse('https://codescene.io/docs/guides/technical/code-health.html'));
      },
    })
  );
}

async function findOrOpenDocument(uri: vscode.Uri) {
  let document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
  if (!document) {
    document = await vscode.workspace.openTextDocument(uri);
  }
  return document;
}

export interface IssueInfo {
  category: string;
  position: vscode.Position;
  fnName?: string;
}

export interface InteractiveDocsParams {
  issueInfo: IssueInfo;
  document: vscode.TextDocument;
  fnToRefactor?: FnToRefactor;
}

export function issueToDocsParams(issue: DeltaIssue, fnInfo?: DeltaFunctionInfo) {
  const params = toDocsParams(issue.changeDetail.category, issue.position, issue.parentDocument);
  params.issueInfo.fnName = fnInfo?.fnName;
  params.fnToRefactor = fnInfo?.fnToRefactor;
  return params;
}

export function toDocsParams(
  category: string,
  position: vscode.Position,
  document: vscode.TextDocument,
  fnToRefactor?: FnToRefactor
): InteractiveDocsParams {
  return { issueInfo: { category, position, fnName: fnToRefactor?.name }, document, fnToRefactor };
}

export function categoryToDocsCode(issueCategory: string) {
  return issueCategory.replace(/ /g, '-').replace(/,/g, '').toLowerCase();
}
