import * as assert from 'assert';

import { getFileExtension } from '../../utils';

suite('Utils Test Suite', () => {
  test('getFileExtension', () => {
    assert.strictEqual(getFileExtension(''), '');
    assert.strictEqual(getFileExtension('test-file.txt'), 'txt');
    assert.strictEqual(getFileExtension('test-file'), '');
  });
});
