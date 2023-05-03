import * as assert from 'assert';

import { getFileExtension, getFileNameWithoutExtension, getFunctionNameRange, rankNamesBy } from '../../utils';

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
    // If the function name contains a period, the part before the period might be the class name
    // so we should match only the part after the period.
    assert.deepStrictEqual(getFunctionNameRange('    public foo() {', 'className.foo'), [11, 14]);
    // If the actual line contains the full name including the period, we should match the full name.
    // Perhaps the language supports using periods in function names.
    assert.deepStrictEqual(getFunctionNameRange('    public weird.name() {', 'weird.name'), [11, 21]);
  });

  test('rankNamesBy - best match first', () => {
    const names = ['foo', 'bar', 'baz', 'foobar', 'bazbar'];
    const match = 'foo';
    const expected = ['foo', 'foobar', 'bar', 'baz', 'bazbar'];
    const actual = names.slice();
    rankNamesBy(match, actual);
    assert.deepStrictEqual(actual, expected);
  });

  test('rankNamesBy - case insensitive', () => {
    const names = ['foo', 'bar', 'baz', 'foobar', 'bazbar'];
    const match = 'FOO';
    const expected = ['foo', 'foobar', 'bar', 'baz', 'bazbar'];
    const actual = names.slice();
    rankNamesBy(match, actual);
    assert.deepStrictEqual(actual, expected);
  });
});
