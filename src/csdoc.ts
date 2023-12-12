import { readFile } from 'fs/promises';
import { join } from 'path';
import * as vscode from 'vscode';

class CsDocProvider implements vscode.TextDocumentContentProvider {
  logoUrl: string | undefined;

  constructor(private docPath: string) {}

  async getLogoUrl(): Promise<string> {
    if (!this.logoUrl) {
      // Read the logo from the extension's assets folder and base64 encode it.
      const path = join(this.docPath, '..', 'assets', 'cs-logo-small.png');
      const data = await readFile(path);
      this.logoUrl = data.toString('base64');
    }
    return this.logoUrl;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const url = await this.getLogoUrl();
    const header = `# <img src="data:image/png;base64,${url}" width="64" height="64" align="center" />&nbsp; `;

    const path = join(this.docPath, uri.path);
    const content = await readFile(path);

    return header + content.toString();
  }
}

export function registerCsDocProvider(docPath: string) {
  const provider = new CsDocProvider(docPath);
  const providerRegistration = vscode.workspace.registerTextDocumentContentProvider('csdoc', provider);
  return providerRegistration;
}

export function categoryToDocsCode(issueCategory: string) {
  return issueCategory.replace(/ /g, '-').replace(/,/g, '').toLowerCase();
}
