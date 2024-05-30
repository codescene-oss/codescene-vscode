import path from 'path';
import { window } from 'vscode';
import { codeHealthRulesCheck } from './codescene-interop';
import { outputChannel } from './log';

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
    const msg = result.stdout;
    const error = result.stderr;
    outputChannel.appendLine('----------');
    if (error.trim() !== '') {
      outputChannel.append(error);
    }
    outputChannel.append(msg);
    outputChannel.appendLine('----------');
    outputChannel.show();
  } else {
    void window.showErrorMessage('No file is currently selected.');
  }
}
