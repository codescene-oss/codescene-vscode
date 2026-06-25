import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { handleCodesceneConfigChange, reReviewAfterCodeHealthRulesChange } from '../../codescene-re-review';
import CsDiagnostics from '../../diagnostics/cs-diagnostics';
import {
  mockWorkspaceFolders,
  createMockWorkspaceFolder,
  restoreDefaultWorkspaceFolders,
  setOpenTextDocumentHandler,
} from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';

suite('Codescene re-review handlers Test Suite', () => {
  let reviewCalls: Array<{ fileName: string; options: any }>;

  setup(() => {
    reviewCalls = [];
    const originalReview = CsDiagnostics.review.bind(CsDiagnostics);
    (CsDiagnostics as any).review = (document: any, options: any) => {
      reviewCalls.push({ fileName: document.fileName, options });
      return originalReview(document, options);
    };
    setOpenTextDocumentHandler(async (uriOrPath: any) => {
      const fsPath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath;
      return { fileName: fsPath, uri: { fsPath }, version: 1, getText: () => 'content' };
    });
  });

  teardown(() => {
    restoreDefaultWorkspaceFolders();
    setOpenTextDocumentHandler(undefined);
  });

  test('reReviewAfterCodeHealthRulesChange reviews visible and monitor files', async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescene-rereview-'));
    const visibleFile = path.join(testDir, 'visible.ts');
    const monitorFile = path.join(testDir, 'monitor.ts');
    fs.writeFileSync(visibleFile, 'export const x = 1;');
    fs.writeFileSync(monitorFile, 'export const y = 2;');

    reReviewAfterCodeHealthRulesChange({
      getVisibleFiles: () => new Set([visibleFile]),
      getMonitorFilePaths: () => [monitorFile],
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const reviewed = reviewCalls.map((call) => call.fileName);
    assert.ok(reviewed.includes(visibleFile));
    assert.ok(reviewed.includes(monitorFile));
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('handleCodesceneConfigChange re-reviews visible files', async function () {
    this.timeout(10000);
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescene-config-'));
    const configPath = path.join(testDir, '.codescene', 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{}');
    mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);

    const visibleFile = path.join(testDir, 'open.ts');
    fs.writeFileSync(visibleFile, 'export const x = 1;');

    handleCodesceneConfigChange({ fsPath: configPath } as any, {
      getVisibleFiles: () => new Set([visibleFile]),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(reviewCalls.some((call) => call.fileName === visibleFile));
    fs.rmSync(testDir, { recursive: true, force: true });
  });
});
