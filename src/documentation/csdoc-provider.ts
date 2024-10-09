import { readFile } from 'fs/promises';
import { join } from 'path';
import * as vscode from 'vscode';
import { DeltaIssue } from '../code-health-monitor/tree-model';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import { getLogoUrl, registerCommandWithTelemetry } from '../utils';
import { CategoryWithPosition, DocumentationPanel } from './documentation-panel';

class CsDocProvider implements vscode.TextDocumentContentProvider {
  constructor(private extensionPath: string) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const url = await getLogoUrl(this.extensionPath);
    const header = `# <img src="data:image/png;base64,${url}" width="64" height="64" align="center" />&nbsp; `;

    const path = join(this.extensionPath, 'docs', uri.path);
    const content = await readFile(path);

    return header + content.toString();
  }
}

export function register(context: vscode.ExtensionContext) {
  const provider = new CsDocProvider(context.extensionPath);
  const providerDisposable = vscode.workspace.registerTextDocumentContentProvider('csdoc', provider);
  context.subscriptions.push(providerDisposable);

  const openInteractiveDocsPanel = registerCommandWithTelemetry({
    commandId: 'codescene.openInteractiveDocsPanel',
    handler: (params) => {
      const panelParams = Object.assign({ extensionUri: context.extensionUri }, params);
      DocumentationPanel.createOrShow(panelParams);
    },
    logArgs: (params: InteractiveDocsParams) => ({ category: params.codeSmell.category }),
  });

  context.subscriptions.push(openInteractiveDocsPanel);
}

export interface InteractiveDocsParams {
  codeSmell: CategoryWithPosition;
  documentUri: vscode.Uri;
  request?: CsRefactoringRequest;
}

export function issueToDocsParams(issue: DeltaIssue, request?: CsRefactoringRequest) {
  return toDocsParams(issue.changeDetail.category, issue.position, issue.parentUri, request);
}

export function toDocsParams(
  category: string,
  position: vscode.Position,
  documentUri: vscode.Uri,
  request?: CsRefactoringRequest
): InteractiveDocsParams {
  return { codeSmell: { category, position }, documentUri, request };
}

export function categoryToDocsCode(issueCategory: string) {
  return issueCategory.replace(/ /g, '-').replace(/,/g, '').toLowerCase();
}
