import * as assert from 'assert';
import * as path from 'path';

import { getFileExtension, getWorkspaceCwd } from '../../utils';
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
});
