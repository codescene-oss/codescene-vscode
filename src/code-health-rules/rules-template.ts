import fs from 'fs';
import path from 'path';
import { QuickPickItem, Uri, WorkspaceFolder, window, workspace } from 'vscode';
import { DevtoolsAPI } from '../devtools-api';

const rulesPathAndFile: string = '.codescene/code-health-rules.json';

interface WorkspaceFolderItem extends QuickPickItem {
  folder: WorkspaceFolder;
}

async function pickFolder(
  folders: ReadonlyArray<WorkspaceFolder>,
  placeHolder: string
): Promise<WorkspaceFolder | undefined> {
  if (folders.length === 1) {
    return Promise.resolve(folders[0]);
  }

  const selected = await window.showQuickPick(
    folders.map<WorkspaceFolderItem>((folder) => {
      return { label: folder.name, description: folder.uri.fsPath, folder: folder };
    }),
    { placeHolder: placeHolder }
  );
  if (selected === undefined) {
    return undefined;
  }
  return selected.folder;
}

/**
 * Function to generate rules template file and store it in a workspace folder.
 * @returns void
 */
export async function createRulesTemplate() {
  const folders = workspace.workspaceFolders;
  if (!folders) {
    throw new Error('A CodeScene rules template can only be generated if VS Code is opened on a workspace folder.');
  }
  const noRulesFolders = folders.filter((folder) => !fs.existsSync(path.join(folder.uri.fsPath, rulesPathAndFile)));
  if (noRulesFolders.length === 0) {
    if (folders.length === 1) {
      void window.showInformationMessage('The workspace already contains a CodeScene rules file.');
    } else {
      void window.showInformationMessage('All workspace folders already contain a CodeScene rules file.');
    }
    return;
  }
  const folder = await pickFolder(noRulesFolders, 'Select a workspace folder to generate a CodeScene rules file for');
  if (!folder) {
    return;
  }
  const configUri: Uri = Uri.joinPath(folder.uri, rulesPathAndFile);
  const template = await DevtoolsAPI.codeHealthRulesTemplate();
  await workspace.fs.writeFile(configUri, Buffer.from(template, 'utf8'));
  void window.showInformationMessage('CodeScene rules file successfully generated.');
}
