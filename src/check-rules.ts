import { outputChannel } from './log';
import { workspace , window , WorkspaceFolder, QuickPickItem, Uri, TextDocument } from 'vscode';
import { codeHealthRulesCheck } from './codescene-interop';
import * as path from 'path';

export function checkCodeHealthRules(cliPath: string){
  const editor = window.activeTextEditor;
  if (editor && editor.document) {
    void checkRules(cliPath, editor.document);
  } else {
    void window.showErrorMessage('No file is currently selected.');
  }
}

/**
 * Get the root path for workspace for a given file
 * @param absoluteFilePath path of file to find workspace for
 * @returns string with most specific root path found in open workspaces
 */
function getRootPath(absoluteFilePath: string) : string {
  const folders = workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    return "";
  }
  let mostSpecificMatch = "";
  folders.forEach((item) => {
    const rootPath = item.uri.fsPath;
    if (absoluteFilePath.includes(rootPath) && rootPath.length > mostSpecificMatch.length) {
      mostSpecificMatch = rootPath;
    }
  });
  return mostSpecificMatch;
}

/**
 * Get a relative path for a file by removing rootPath and leading /
 * @returns string representing relative path
 */
function getRelativeFilePath(filePath: string, rootPath: string) : string {
  let tmp = filePath.replace(rootPath, "");
  if (tmp.charAt(0) == "/") {
    tmp = tmp.substring(1, tmp.length);
  }
  return tmp;

}

/**
 * Function to show matching code health rule for currently opened file.
 * @returns void
 */
async function checkRules(cliPath: string, document: TextDocument) {
  const absoluteFilePath = document.uri.fsPath;
  const rootPath = getRootPath(absoluteFilePath);
  const relativeFilePath = getRelativeFilePath(absoluteFilePath, rootPath);
  const result = await codeHealthRulesCheck(cliPath, rootPath, relativeFilePath);
  outputChannel.appendLine('----------\n' + result.stdout + '----------');
  outputChannel.show();
  void window.showInformationMessage('CodeScene rules file successfully generated.');
}