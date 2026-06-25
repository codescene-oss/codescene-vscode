import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { SavedFilesTracker } from '../../saved-files-tracker';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { consumeWorkspaceFileActivity, resetWorkspaceFileActivity } from '../../git/workspace-activity';
import { fireOnDidSaveTextDocument } from '../setup';

suite('SavedFilesTracker Test Suite', () => {
  setup(() => {
    resetWorkspaceFileActivity();
  });

  test('on save marks workspace activity and tracks visible open files', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-files-'));
    const context = createMockExtensionContext(testDir);
    const tracker = new SavedFilesTracker(context as any);
    tracker.start();

    const filePath = path.join(testDir, 'saved.ts');
    (vscode.window as any).visibleTextEditors = [{ document: { fileName: filePath } }];
    (vscode.window as any).tabGroups = { all: [] };

    fireOnDidSaveTextDocument({ fileName: filePath, uri: { fsPath: filePath } });
    assert.strictEqual(consumeWorkspaceFileActivity(), true);
    assert.ok(tracker.getSavedFiles().has(filePath));
    tracker.dispose();
    fs.rmSync(testDir, { recursive: true, force: true });
  });
});
