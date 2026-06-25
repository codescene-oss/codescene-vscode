import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodesceneFileListeners } from '../../codescene-file-listeners';
import {
  createMockWorkspaceFolder,
  fireOnDidCreateFiles,
  fireOnDidDeleteFiles,
  fireOnDidRenameFiles,
  fireOnDidSaveTextDocument,
  mockWorkspaceFolders,
  restoreDefaultWorkspaceFolders,
  setOpenTextDocumentHandler,
} from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';

suite('CodesceneFileListeners Test Suite', () => {
  let testDir: string;
  let rulesPath: string;
  let configPath: string;
  let rulesChanged: number;
  let configChanged: number;
  let listeners: CodesceneFileListeners;

  setup(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescene-listeners-'));
    rulesPath = path.join(testDir, '.codescene', 'code-health-rules.json');
    configPath = path.join(testDir, '.codescene', 'config.json');
    fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
    fs.writeFileSync(rulesPath, '{}');
    fs.writeFileSync(configPath, '{}');

    mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);
    setOpenTextDocumentHandler(async (uriOrPath: any) => {
      const fsPath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath;
      return { fileName: fsPath, version: 2, uri: { fsPath } };
    });
    rulesChanged = 0;
    configChanged = 0;
    listeners = new CodesceneFileListeners({
      onRulesFileChanged: () => rulesChanged++,
      onConfigFileChanged: () => configChanged++,
    });
    listeners.register(createMockExtensionContext(testDir));
  });

  teardown(() => {
    setOpenTextDocumentHandler(undefined);
    restoreDefaultWorkspaceFolders();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('records rules file version on save', async () => {
    fireOnDidSaveTextDocument({ uri: { fsPath: rulesPath }, fileName: rulesPath, version: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(listeners.getCodeHealthFileVersions().get(rulesPath), 2);
    assert.ok(rulesChanged >= 1);
  });

  test('removes rules file version on delete', async () => {
    listeners.getCodeHealthFileVersions().set(rulesPath, 1);
    fireOnDidDeleteFiles([{ fsPath: rulesPath }]);
    assert.strictEqual(listeners.getCodeHealthFileVersions().has(rulesPath), false);
    assert.ok(rulesChanged >= 1);
  });

  test('notifies config file changes', () => {
    fireOnDidCreateFiles([{ fsPath: configPath }]);
    assert.ok(configChanged >= 1);
  });

  test('handles rules file rename', () => {
    const renamedPath = path.join(testDir, 'pkg', '.codescene', 'code-health-rules.json');
    listeners.getCodeHealthFileVersions().set(rulesPath, 1);
    fireOnDidRenameFiles([{ oldUri: { fsPath: rulesPath }, newUri: { fsPath: renamedPath } }]);
    assert.strictEqual(listeners.getCodeHealthFileVersions().has(rulesPath), false);
    assert.ok(rulesChanged >= 1);
  });

  test('initializeCodeHealthFileVersions loads discovered rules files', async () => {
    await listeners.initializeCodeHealthFileVersions(testDir);
    const versions = listeners.getCodeHealthFileVersions();
    assert.ok([...versions.keys()].some((key) => key.replace(/\\/g, '/') === rulesPath.replace(/\\/g, '/')));
  });
});
