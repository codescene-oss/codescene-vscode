import * as path from 'path';
import * as vscode from 'vscode';

export function createMockExtensionContext(testDir: string): vscode.ExtensionContext {
  const extensionPath = path.join(__dirname, '../../..');
  return {
    subscriptions: [] as vscode.Disposable[],
    extensionPath,
    extensionUri: vscode.Uri.file(extensionPath),
    globalState: {} as any,
    workspaceState: {} as any,
    secrets: {} as any,
    storagePath: testDir,
    globalStoragePath: testDir,
    logPath: testDir,
    extensionMode: 3
  } as vscode.ExtensionContext;
}
