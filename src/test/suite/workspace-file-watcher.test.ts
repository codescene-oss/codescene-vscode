import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceFileWatcher } from '../../git/workspace-file-watcher';
import { consumeWorkspaceFileActivity, resetWorkspaceFileActivity } from '../../git/workspace-activity';
import {
  fireOnDidCreateFiles,
  fireOnDidDeleteFiles,
  fireOnDidRenameFiles,
  fireOnDidSaveTextDocument,
  resetWorkspaceEventListeners,
} from '../setup';

suite('WorkspaceFileWatcher Test Suite', () => {
  const extensionPath = path.join(__dirname, '../../..');
  const mockContext = {
    subscriptions: [] as vscode.Disposable[],
    extensionPath,
    extensionUri: vscode.Uri.file(extensionPath),
    asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
  } as vscode.ExtensionContext;

  setup(() => {
    resetWorkspaceEventListeners();
    resetWorkspaceFileActivity();
    WorkspaceFileWatcher.disposeShared();
  });

  teardown(() => {
    WorkspaceFileWatcher.disposeShared();
    resetWorkspaceEventListeners();
    resetWorkspaceFileActivity();
  });

  test('fires create event for supported source files', () => {
    const watcher = WorkspaceFileWatcher.init(mockContext)!;
    const events: Array<{ type: string; uri: vscode.Uri }> = [];
    watcher.onDidFileEvent((event) => events.push(event));

    const uri = vscode.Uri.file('/repo/src/new-file.ts');
    fireOnDidCreateFiles([uri]);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'create');
    assert.strictEqual(events[0].uri.fsPath, uri.fsPath);
    assert.strictEqual(consumeWorkspaceFileActivity(), true);
  });

  test('ignores create events for unsupported file types', () => {
    const watcher = WorkspaceFileWatcher.init(mockContext)!;
    const events: Array<{ type: string; uri: vscode.Uri }> = [];
    watcher.onDidFileEvent((event) => events.push(event));

    fireOnDidCreateFiles([vscode.Uri.file('/repo/readme.md')]);

    assert.strictEqual(events.length, 0);
    assert.strictEqual(consumeWorkspaceFileActivity(), false);
  });

  test('fires change event on save for supported source files', () => {
    const watcher = WorkspaceFileWatcher.init(mockContext)!;
    const events: Array<{ type: string; uri: vscode.Uri }> = [];
    watcher.onDidFileEvent((event) => events.push(event));

    const uri = vscode.Uri.file('/repo/src/changed.ts');
    fireOnDidSaveTextDocument({ uri });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'change');
    assert.strictEqual(consumeWorkspaceFileActivity(), true);
  });

  test('fires delete event for all files and file event only for supported types', () => {
    const watcher = WorkspaceFileWatcher.init(mockContext)!;
    const deleted: string[] = [];
    const events: Array<{ type: string; uri: vscode.Uri }> = [];
    watcher.onDidDelete((uri) => deleted.push(uri.fsPath));
    watcher.onDidFileEvent((event) => events.push(event));

    const supportedUri = vscode.Uri.file('/repo/src/remove.ts');
    const unsupportedUri = vscode.Uri.file('/repo/readme.md');
    fireOnDidDeleteFiles([supportedUri, unsupportedUri]);

    assert.deepStrictEqual(deleted.sort(), [supportedUri.fsPath, unsupportedUri.fsPath].sort());
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'delete');
    assert.strictEqual(events[0].uri.fsPath, supportedUri.fsPath);
    assert.strictEqual(consumeWorkspaceFileActivity(), true);
  });

  test('rename emits delete for old path and create for new supported path', () => {
    const watcher = WorkspaceFileWatcher.init(mockContext)!;
    const deleted: string[] = [];
    const events: Array<{ type: string; uri: vscode.Uri }> = [];
    watcher.onDidDelete((uri) => deleted.push(uri.fsPath));
    watcher.onDidFileEvent((event) => events.push(event));

    const oldUri = vscode.Uri.file('/repo/src/old-name.ts');
    const newUri = vscode.Uri.file('/repo/src/new-name.ts');
    fireOnDidRenameFiles([{ oldUri, newUri }]);

    assert.deepStrictEqual(deleted, [oldUri.fsPath]);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'delete');
    assert.strictEqual(events[0].uri.fsPath, oldUri.fsPath);
    assert.strictEqual(events[1].type, 'create');
    assert.strictEqual(events[1].uri.fsPath, newUri.fsPath);
  });
});
