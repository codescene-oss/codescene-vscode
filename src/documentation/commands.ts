import * as vscode from 'vscode';
import { DeltaFunctionInfo, DeltaIssue } from '../code-health-monitor/tree-model';
// CS-5069 Remove ACE from public version
// import { FnToRefactor } from '../devtools-api/refactor-models';
import Telemetry from '../telemetry';
import { CodeSceneCWFDocsTabPanel } from '../codescene-tab/cwf-webview-docs-panel';

export function register(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'codescene.openInteractiveDocsPanel',
      (params: InteractiveDocsParams, source: string) => {
        Telemetry.logUsage('openInteractiveDocsPanel', { source, category: params.issueInfo.category });
        CodeSceneCWFDocsTabPanel.show(params);
      }
    ),
    // A query param friendly version of openInteractiveDocsPanel
    vscode.commands.registerCommand('codescene.openInteractiveDocsFromDiagnosticTarget', async (queryParams) => {
      const { category, lineNo, charNo, documentUri } = queryParams;
      Telemetry.logUsage('openInteractiveDocsPanel', { source: 'diagnostic-item', category });
      const params: InteractiveDocsParams = {
        issueInfo: { category, position: new vscode.Position(lineNo, charNo) },
        document: await findOrOpenDocument(documentUri),
      };
      CodeSceneCWFDocsTabPanel.show(params);
    }),
    vscode.commands.registerCommand('codescene.openCodeHealthDocs', () => {
      Telemetry.logUsage('openCodeHealthDocs');
      void vscode.env.openExternal(vscode.Uri.parse('https://codescene.io/docs/guides/technical/code-health.html'));
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
  position?: vscode.Position;
  fnName?: string;
}

export interface InteractiveDocsParams {
  issueInfo: IssueInfo;
  document: vscode.TextDocument;
  // CS-5069 Remove ACE from public version
  // fnToRefactor?: FnToRefactor;
}

export function isInteractiveDocsParams(obj: unknown): obj is InteractiveDocsParams {
  if (!obj) return false;
  if (typeof obj === 'object') {
    Object.hasOwnProperty.call(obj, 'issueInfo');
    return obj.hasOwnProperty('issueInfo') && obj.hasOwnProperty('document');
  }
  return false;
}

export function issueToDocsParams(issue: DeltaIssue, fnInfo?: DeltaFunctionInfo) {
  const params = toDocsParams(issue.changeDetail.category, issue.parentDocument, issue.position);
  params.issueInfo.fnName = fnInfo?.fnName;
  // CS-5069 Remove ACE from public version
  // params.fnToRefactor = fnInfo?.fnToRefactor;
  return params;
}

export function toDocsParams(
  category: string,
  document: vscode.TextDocument,
  position?: vscode.Position,
  // fnToRefactor?: FnToRefactor
): InteractiveDocsParams {
  return { issueInfo: { category, position /*, fnName: fnToRefactor?.name*/ }, document, /* fnToRefactor // CS-5069 Remove ACE */ };
}

export function categoryToDocsCode(issueCategory: string) {
  return issueCategory.replace(/ /g, '-').replace(/,/g, '').toLowerCase();
}
