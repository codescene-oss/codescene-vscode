import * as path from 'path';
import * as fs from 'fs';
import { workspace as Workspace, window as Window, WorkspaceFolder, QuickPickItem, Uri } from 'vscode';
import { codeHealthRulesJson } from './codescene-interop';

const rulesPathAndFile: string = '.codescene/code-health-rules.json';

interface WorkspaceFolderItem extends QuickPickItem {
  folder: WorkspaceFolder;
}

async function pickFolder(folders: ReadonlyArray<WorkspaceFolder>, placeHolder: string): Promise<WorkspaceFolder | undefined> {
  if (folders.length === 1) {
    return Promise.resolve(folders[0]);
  }

  const selected = await Window.showQuickPick(
    folders.map<WorkspaceFolderItem>((folder) => { return { label: folder.name, description: folder.uri.fsPath, folder: folder }; }),
    { placeHolder: placeHolder }
  );
  if (selected === undefined) {
    return undefined;
  }
  return selected.folder;
}


/**
 * Function to generate rules template file and store it in a workspace folder.
 * @param cliPath path to the CodeScene binary
 * @returns void
 */
export async function createRulesTemplate(cliPath: string) {
  const folders = Workspace.workspaceFolders;
  if (!folders) {
    Window.showErrorMessage('A CodeScene rules template can only be generated if VS Code is opened on a workspace folder.');
    return;
  }
  const noRulesFolders = folders.filter(folder =>
    !(fs.existsSync(path.join(folder.uri.fsPath, rulesPathAndFile)))
  );
  if (noRulesFolders.length === 0) {
    if (folders.length === 1) {
      Window.showInformationMessage('The workspace already contains a CodeScene rules file.');
    } else {
      Window.showInformationMessage('All workspace folders already contain a CodeScene rules file.');
    }
    return;
  }
  const folder = await pickFolder(noRulesFolders, 'Select a workspace folder to generate a CodeScene rules file for');
  if (!folder) {
    return;
  }
  const configUri: Uri = Uri.joinPath(folder.uri, rulesPathAndFile);
  const result = await codeHealthRulesJson(cliPath);
  await Workspace.fs.writeFile(configUri, Buffer.from(result.stdout, 'utf8'));
  Window.showInformationMessage('CodeScene rules file successfully generated.');
}