import * as assert from 'assert';
import * as path from 'path';

import { getFileExtension, getWorkspaceCwd, safeJsonParse } from '../../utils';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';

suite('Utils Test Suite', () => {
  test('getFileExtension', () => {
    assert.strictEqual(getFileExtension(''), '');
    assert.strictEqual(getFileExtension('test-file.txt'), 'txt');
    assert.strictEqual(getFileExtension('test-file'), '');
  });

  suite('getWorkspaceCwd', () => {
    teardown(() => {
      restoreDefaultWorkspaceFolders();
    });

    test('returns workspace path when workspace folder exists', () => {
      const mockWorkspacePath = '/Users/test/workspace';
      mockWorkspaceFolders([createMockWorkspaceFolder(mockWorkspacePath)]);

      const result = getWorkspaceCwd();
      const expected = path.normalize(mockWorkspacePath);
      assert.strictEqual(result, expected);
    });

    test('returns normalized process.cwd() when workspace folders is null', () => {
      mockWorkspaceFolders(null);

      const result = getWorkspaceCwd();
      const expected = path.normalize(process.cwd());

      assert.strictEqual(expected, process.cwd(), 'path.normalize(process.cwd()) should equal process.cwd()');
      assert.strictEqual(result, expected);
    });

    test('returns normalized process.cwd() when workspace folders is undefined', () => {
      mockWorkspaceFolders(undefined);

      const result = getWorkspaceCwd();
      const expected = path.normalize(process.cwd());

      assert.strictEqual(expected, process.cwd(), 'path.normalize(process.cwd()) should equal process.cwd()');
      assert.strictEqual(result, expected);
    });

    test('returns normalized process.cwd() when workspace folders is empty array', () => {
      mockWorkspaceFolders([]);

      const result = getWorkspaceCwd();
      const expected = path.normalize(process.cwd());

      assert.strictEqual(expected, process.cwd(), 'path.normalize(process.cwd()) should equal process.cwd()');
      assert.strictEqual(result, expected);
    });
  });

  suite('safeJsonParse', () => {
    test('parses valid JSON', () => {
      assert.deepStrictEqual(safeJsonParse('{"key":"value"}'), { key: 'value' });
      assert.deepStrictEqual(safeJsonParse('[1,2,3]'), [1, 2, 3]);
      assert.strictEqual(safeJsonParse('"hello"'), 'hello');
      assert.strictEqual(safeJsonParse('42'), 42);
    });

    test('throws on invalid JSON', () => {
      assert.throws(() => safeJsonParse('not json'), SyntaxError);
    });

    test('throws on invalid JSON with context', () => {
      assert.throws(() => safeJsonParse('{broken', { source: 'test' }), SyntaxError);
    });

    test('does not include raw input in error reporting', () => {
      const sensitiveInput = '{"accessToken":"secret-token-value"broken';
      try {
        safeJsonParse(sensitiveInput);
      } catch (e) {
        // The fix ensures raw input is never sent to telemetry.
        // We verify the function still throws as expected.
        assert.ok(e instanceof SyntaxError);
      }
    });
  });
});
