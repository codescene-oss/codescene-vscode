import * as assert from 'assert';

import { getFileExtension, getFileNameWithoutExtension, getFunctionNameRange } from '../../utils';

suite('Utils Test Suite', () => {
  test('getFileExtension', () => {
    assert.strictEqual(getFileExtension(''), '');
    assert.strictEqual(getFileExtension('test-file.txt'), 'txt');
    assert.strictEqual(getFileExtension('test-file'), '');
  });

  test('getFileNameWithoutExtension', () => {
    assert.strictEqual(getFileNameWithoutExtension(''), '');
    assert.strictEqual(getFileNameWithoutExtension('test-file.txt'), 'test-file');
    assert.strictEqual(getFileNameWithoutExtension('test-file'), 'test-file');
  });

  test('getFunctionNameRange', () => {
    assert.deepStrictEqual(getFunctionNameRange('', ''), [0, 0]);
    assert.deepStrictEqual(getFunctionNameRange('function foo() {', 'foo'), [9, 12]);
    assert.deepStrictEqual(getFunctionNameRange('function foo() {', 'bar'), [0, 0]);
    assert.deepStrictEqual(getFunctionNameRange('(defun foo ()', 'foo'), [7, 10]);
  });
});
