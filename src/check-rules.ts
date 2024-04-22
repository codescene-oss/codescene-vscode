import { dirname } from 'path';
import * as vscode from 'vscode';
import { LimitingExecutor } from './executor';
import { logOutputChannel, outputChannel } from './log';
import { getFileExtension } from './utils';
import { window } from 'vscode';
import { disconnect } from 'process';

export default class CheckRules {
  private static _instance: CheckRules;
  private readonly executor: LimitingExecutor = new LimitingExecutor();
  static init(cliPath: string): void {
    CheckRules._instance = new CheckRules(cliPath);
  }

  constructor(private cliPath: string) { }

  static get instance(): CheckRules {
    return CheckRules._instance;
  }

  checkRules(document: vscode.TextDocument): Promise<void> {
    const extension = getFileExtension(document.fileName);
    let filePath = document.uri.fsPath;
    let workspacePath = "";
    if (vscode.workspace.workspaceFolders) {
      workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      filePath = vscode.workspace.asRelativePath(document.uri);
    } else {
      outputChannel.appendLine('No workplace opened to check code health rules for.');
    }

    let cmd = {
      command: this.cliPath,
      args: ['check-rules', filePath],
      taskId: taskId(document),
    };
    const result = this.executor.execute(cmd, { cwd: workspacePath });

    const prom = result.then(({ stdout, duration }) => {
      outputChannel.appendLine('----------\n' + stdout + '----------');
    });
    return prom;
  }
}

function taskId(document: vscode.TextDocument) {
  return document.uri.fsPath;
}

/**
 * Function to show matching code health rule for currently opened file.
 * @returns void
 */
export function checkCodeHealthRules() {
  const editor = window.activeTextEditor;
  if (editor && editor.document) {
    void CheckRules.instance.checkRules(editor.document);
  } else {
    void window.showErrorMessage('No file is currently selected.');
  }
}
