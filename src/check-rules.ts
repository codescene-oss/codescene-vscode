import { outputChannel } from './log';
import { workspace , window , WorkspaceFolder, QuickPickItem, Uri, TextDocument } from 'vscode';
import { codeHealthRulesCheck } from './codescene-interop';

export function checkCodeHealthRules(cliPath: string) {
  const editor = window.activeTextEditor;
  if (editor && editor.document) {
    void checkRules(cliPath, editor.document);
  } else {
    void window.showErrorMessage('No file is currently selected.');
  }
}

/**
 * Function to show matching code health rule for currently opened file.
 * @returns void
 */
async function checkRules(cliPath: string, document: TextDocument) {
  let workspacePath = "";
  let filePath = "";
  if (workspace.workspaceFolders) {
    workspacePath = workspace.workspaceFolders[0].uri.fsPath;
    filePath = workspace.asRelativePath(document.uri);
  }
  const result = await codeHealthRulesCheck(cliPath, workspacePath, filePath);
  outputChannel.appendLine('----------\n' + result.stdout + '----------');
  outputChannel.show();
  void window.showInformationMessage('CodeScene rules file successfully generated.');
}