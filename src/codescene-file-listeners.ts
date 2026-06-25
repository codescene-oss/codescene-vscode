import vscode from 'vscode';
import { discoverCodeHealthRulesFileUris } from './git/codescene-file-discovery';
import { getWorkspacePath } from './git-utils';
import { logOutputChannel } from './log';
import { getWorkspaceFolder } from './utils';
import { isCodeHealthRulesFile, isCodesceneConfigFile } from './utils/workspace-patterns';

export interface CodesceneFileListenerCallbacks {
  onRulesFileChanged: () => void;
  onConfigFileChanged: (uri: vscode.Uri) => void;
}

export class CodesceneFileListeners {
  private readonly codeHealthFileVersion = new Map<string, number>();

  constructor(private readonly callbacks: CodesceneFileListenerCallbacks) {}

  getCodeHealthFileVersions(): Map<string, number> {
    return this.codeHealthFileVersion;
  }

  dispatchCodesceneFileChange(uri: vscode.Uri, event: 'upsert' | 'delete'): void {
    const filePath = uri.fsPath;
    if (isCodeHealthRulesFile(filePath)) {
      if (event === 'delete') {
        this.removeRulesFileVersion(uri);
      } else {
        void this.recordRulesFileVersion(uri);
      }
      return;
    }
    if (isCodesceneConfigFile(filePath)) {
      this.callbacks.onConfigFileChanged(uri);
    }
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.dispatchCodesceneFileChange(document.uri, 'upsert');
      }),
      vscode.workspace.onDidCreateFiles((event) => {
        for (const uri of event.files) {
          this.dispatchCodesceneFileChange(uri, 'upsert');
        }
      }),
      vscode.workspace.onDidDeleteFiles((event) => {
        for (const uri of event.files) {
          this.dispatchCodesceneFileChange(uri, 'delete');
        }
      }),
      vscode.workspace.onDidRenameFiles((event) => {
        for (const { oldUri, newUri } of event.files) {
          this.dispatchCodesceneFileChange(oldUri, 'delete');
          this.dispatchCodesceneFileChange(newUri, 'upsert');
        }
      })
    );
  }

  async initializeCodeHealthFileVersions(gitRootPath?: string): Promise<void> {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return;
    }

    const workspacePath = getWorkspacePath(workspaceFolder);
    const rulesFiles = await discoverCodeHealthRulesFileUris(workspacePath, gitRootPath);

    for (const uri of rulesFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        this.codeHealthFileVersion.set(document.fileName, document.version);
      } catch (e) {
        logOutputChannel.warn(`Failed to open code-health-rules.json: ${uri.fsPath}`, e);
      }
    }
  }

  private async recordRulesFileVersion(uri: vscode.Uri): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      this.codeHealthFileVersion.set(document.fileName, document.version);
      this.callbacks.onRulesFileChanged();
    } catch (e) {
      logOutputChannel.warn(`Failed to update code-health-rules.json version: ${uri.fsPath}`, e);
    }
  }

  private removeRulesFileVersion(uri: vscode.Uri): void {
    this.codeHealthFileVersion.delete(uri.fsPath);
    this.callbacks.onRulesFileChanged();
  }
}
