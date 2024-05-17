import { readFile } from 'fs/promises';
import { join } from 'path';
import * as vscode from 'vscode';
import { chScorePrefix, isCsDiagnosticCode } from './review/utils';
import { getLogoUrl } from './utils';

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

  const openDocsForDiagnostic = vscode.commands.registerCommand(
    'codescene.openDocsForDiagnostic',
    async (diag: vscode.Diagnostic) => {
      if (isCsDiagnosticCode(diag.code)) {
        void vscode.commands.executeCommand('codescene.openDocsForIssueCategory', diag.code.value.toString());
      } else if (diag.message.startsWith(chScorePrefix)) {
        void vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.parse('csdoc:code-health.md'));
      }
    }
  );
  const openDocsForCode = vscode.commands.registerCommand(
    'codescene.openDocsForIssueCategory',
    async (category: string) => {
      const docsCode = categoryToDocsCode(category);
      void vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.parse(`csdoc:${docsCode}.md`));
    }
  );
  context.subscriptions.push(openDocsForDiagnostic, openDocsForCode);
}

export function categoryToDocsCode(issueCategory: string) {
  return issueCategory.replace(/ /g, '-').replace(/,/g, '').toLowerCase();
}
