import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileBackedTextDocument } from '../../utils/file-backed-text-document';

suite('FileBackedTextDocument Test Suite', () => {
  let testDir: string;

  setup(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-backed-doc-'));
  });

  teardown(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('fromPath returns document with file content and mtime-based version', async () => {
    const filePath = path.join(testDir, 'sample.ts');
    fs.writeFileSync(filePath, 'export const value = 1;\n');

    const document = await FileBackedTextDocument.fromPath(filePath);
    assert.ok(document);
    assert.strictEqual(document!.getText(), 'export const value = 1;\n');
    assert.strictEqual(document!.fileName, path.normalize(filePath));
    assert.ok(document!.version >= 1);

    const stat = fs.statSync(filePath);
    assert.strictEqual(document!.version, Math.max(1, Math.floor(stat.mtimeMs)));
  });

  test('fromPath returns undefined for missing file', async () => {
    const document = await FileBackedTextDocument.fromPath(path.join(testDir, 'missing.ts'));
    assert.strictEqual(document, undefined);
  });

  test('getText with range returns substring', async () => {
    const filePath = path.join(testDir, 'lines.ts');
    fs.writeFileSync(filePath, 'alpha\nbeta\ngamma\n');

    const document = await FileBackedTextDocument.fromPath(filePath);
    assert.ok(document);
    const range = {
      start: { line: 1, character: 0 },
      end: { line: 2, character: 2 },
    } as any;
    assert.strictEqual(document!.getText(range), 'beta\nga');
  });

  test('lineAt and offsetAt round-trip positions', async () => {
    const filePath = path.join(testDir, 'positions.ts');
    fs.writeFileSync(filePath, 'one\ntwo\n');

    const document = await FileBackedTextDocument.fromPath(filePath);
    assert.ok(document);
    assert.strictEqual(document!.lineAt(1).text, 'two');
    const position = document!.positionAt(5);
    assert.strictEqual(position.line, 1);
    assert.strictEqual(document!.offsetAt(position), 5);
  });

  test('version changes when file mtime changes', async () => {
    const filePath = path.join(testDir, 'mtime.ts');
    fs.writeFileSync(filePath, 'v1');
    const olderMtime = Date.now() - 10_000;
    fs.utimesSync(filePath, new Date(olderMtime), new Date(olderMtime));

    const first = await FileBackedTextDocument.fromPath(filePath);
    assert.ok(first);

    fs.writeFileSync(filePath, 'v2');
    const newerMtime = Date.now() + 10_000;
    fs.utimesSync(filePath, new Date(newerMtime), new Date(newerMtime));

    const second = await FileBackedTextDocument.fromPath(filePath);
    assert.ok(second);
    assert.notStrictEqual(second!.version, first!.version);
    assert.strictEqual(second!.getText(), 'v2');
  });
});
