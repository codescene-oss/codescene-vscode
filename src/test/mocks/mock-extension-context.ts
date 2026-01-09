import * as path from 'path';
import * as vscode from 'vscode';

export function createMockExtensionContext(testDir: string): vscode.ExtensionContext {
  const extensionPath = path.join(__dirname, '../../..');
  const storage = new Map<string, any>();
  return {
    subscriptions: [] as vscode.Disposable[],
    extensionPath,
    extensionUri: vscode.Uri.file(extensionPath),
    globalState: {
      get: <T>(key: string): T | undefined => storage.get(key),
      update: async (key: string, value: any) => { storage.set(key, value); },
      setKeysForSync: (keys: string[]) => {},
      keys: () => Array.from(storage.keys())
    } as any,
    workspaceState: {} as any,
    secrets: {} as any,
    storagePath: testDir,
    globalStoragePath: testDir,
    logPath: testDir,
    extensionMode: 3,
    languageModelAccessInformation: {} as any
  } as vscode.ExtensionContext;
}
