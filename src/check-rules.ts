import { outputChannel } from './log';
import { window } from 'vscode';
import { codeHealthRulesCheck } from './codescene-interop';
import * as path from 'path';

/**
 * Function to show matching code health rule for currently opened file.
 * @returns void
 */
export async function checkCodeHealthRules(cliPath: string) {
  const editor = window.activeTextEditor;
  if (editor && editor.document) {
    const absoluteFilePath = editor.document.uri.fsPath;
    const fileName = path.basename(absoluteFilePath);
    const folder = path.dirname(absoluteFilePath);
    const result = await codeHealthRulesCheck(cliPath, folder, fileName);
    outputChannel.appendLine('----------\n' + result.stdout + '----------');
    outputChannel.show();
  } else {
    void window.showErrorMessage('No file is currently selected.');
  }
}