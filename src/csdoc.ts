import { readFile } from 'fs/promises';
import { join } from 'path';
import * as vscode from 'vscode';
import { getLogoUrl } from './utils';

class CsDocProvider implements vscode.TextDocumentContentProvider {
  logoUrl: string | undefined;

  constructor(private extensionPath: string) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const url = await getLogoUrl(this.extensionPath);
    const header = `# <img src="data:image/png;base64,${url}" width="64" height="64" align="center" />&nbsp; `;

    const path = join(this.extensionPath, 'docs', uri.path);
    const content = await readFile(path);

    return header + content.toString();
  }
}

export function registerCsDocProvider(extensionPath: string) {
  const provider = new CsDocProvider(extensionPath);
  const providerRegistration = vscode.workspace.registerTextDocumentContentProvider('csdoc', provider);
  return providerRegistration;
}

export function categoryToDocsCode(issueCategory: string) {
  return issueCategory.replace(/ /g, '-').replace(/,/g, '').toLowerCase();
}
