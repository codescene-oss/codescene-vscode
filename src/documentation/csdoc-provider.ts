import { readFile } from 'fs/promises';
import { join } from 'path';
import * as vscode from 'vscode';
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
    handler: (params: InteractiveDocsParams) => {
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

export function categoryToDocsCode(issueCategory: string) {
  return issueCategory.replace(/ /g, '-').replace(/,/g, '').toLowerCase();
}
