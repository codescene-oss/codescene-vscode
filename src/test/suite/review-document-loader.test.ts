import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDocumentForBackgroundReview } from '../../review/review-document-loader';
import { FileBackedTextDocument } from '../../utils/file-backed-text-document';
import { TestTextDocument } from '../mocks/test-text-document';
import {
  getOpenTextDocumentCalls,
  resetMockTextDocuments,
  resetWorkspaceEventListeners,
  setMockTextDocuments,
  setOpenTextDocumentHandler,
} from '../setup';

suite('review-document-loader Test Suite', () => {
  let testDir: string;

  setup(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-doc-loader-'));
    resetWorkspaceEventListeners();
  });

  teardown(() => {
    resetWorkspaceEventListeners();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('returns already-open editor document without calling openTextDocument', async () => {
    const filePath = path.join(testDir, 'open.ts');
    const openDocument = new TestTextDocument(filePath, 'open content', 'typescript');
    setMockTextDocuments([openDocument as any]);

    const document = await loadDocumentForBackgroundReview(filePath);
    assert.strictEqual(document, openDocument);
    assert.strictEqual(getOpenTextDocumentCalls().length, 0);
  });

  test('matches open document paths case-insensitively on Windows', async function () {
    if (process.platform !== 'win32') {
      this.skip();
    }

    const filePath = path.join(testDir, 'Case.ts');
    fs.writeFileSync(filePath, 'case content');
    const lowerCasePath = filePath.toLowerCase();
    const openDocument = new TestTextDocument(lowerCasePath, 'case content', 'typescript');
    setMockTextDocuments([openDocument as any]);

    const document = await loadDocumentForBackgroundReview(filePath);
    assert.strictEqual(document, openDocument);
    assert.strictEqual(getOpenTextDocumentCalls().length, 0);
  });

  test('uses FileBackedTextDocument when file is not open', async () => {
    const filePath = path.join(testDir, 'background.ts');
    fs.writeFileSync(filePath, 'background content');

    const document = await loadDocumentForBackgroundReview(filePath);
    assert.ok(document instanceof FileBackedTextDocument);
    assert.strictEqual(document!.getText(), 'background content');
    assert.strictEqual(getOpenTextDocumentCalls().length, 0);
  });

  test('uses openTextDocument when allowOpenTextDocument is true', async () => {
    const filePath = path.join(testDir, 'visible.ts');
    fs.writeFileSync(filePath, 'visible content');
    const openedDocument = new TestTextDocument(filePath, 'visible content', 'typescript');

    setOpenTextDocumentHandler(async () => openedDocument as any);

    const document = await loadDocumentForBackgroundReview(filePath, { allowOpenTextDocument: true });
    assert.strictEqual(document, openedDocument);
    assert.strictEqual(getOpenTextDocumentCalls().length, 1);
  });

  test('does not call openTextDocument when allowOpenTextDocument is false', async () => {
    const filePath = path.join(testDir, 'hidden.ts');
    fs.writeFileSync(filePath, 'hidden content');

    setOpenTextDocumentHandler(async () => {
      throw new Error('openTextDocument should not be called');
    });

    const document = await loadDocumentForBackgroundReview(filePath, { allowOpenTextDocument: false });
    assert.ok(document instanceof FileBackedTextDocument);
    assert.strictEqual(getOpenTextDocumentCalls().length, 0);
  });

  test('returns undefined when allowOpenTextDocument fails', async () => {
    const filePath = path.join(testDir, 'missing-visible.ts');

    setOpenTextDocumentHandler(async () => {
      throw new Error('file not found');
    });

    const document = await loadDocumentForBackgroundReview(filePath, { allowOpenTextDocument: true });
    assert.strictEqual(document, undefined);
    assert.strictEqual(getOpenTextDocumentCalls().length, 1);
  });
});
