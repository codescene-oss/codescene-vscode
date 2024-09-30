import path from 'path';
import { window } from 'vscode';
import { codeHealthRulesCheck } from './codescene-interop';

/**
 * Function to show matching code health rule for currently opened file.
 * @returns void
 */
export async function checkCodeHealthRules() {
  const editor = window.activeTextEditor;
  if (editor && editor.document) {
    const absoluteFilePath = editor.document.uri.fsPath;
    const fileName = path.basename(absoluteFilePath);
    const folder = path.dirname(absoluteFilePath);
    const result = await codeHealthRulesCheck(folder, fileName);
    const error = result.stderr.trim();
    if (error !== '') {
      void window.showErrorMessage(error);
    }
    const msgParts = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    void window.showInformationMessage('Code Health Rules', { modal: true, detail: msgParts.join('\n\n') });
  } else {
    void window.showErrorMessage('No file is currently selected.');
  }
}
