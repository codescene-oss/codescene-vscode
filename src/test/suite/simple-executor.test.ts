import * as assert from 'assert';
import { parseJsonInput, objectToArray, mergeJsonIntoArgs } from '../../simple-executor';

suite('SimpleExecutor Test Suite', () => {
  suite('parseJsonInput', () => {
    test('parseJsonInput', () => {
      assert.deepStrictEqual(parseJsonInput('["arg1", "arg2"]'), ['arg1', 'arg2']);
      assert.deepStrictEqual(parseJsonInput('{"key": "value"}'), { key: 'value' });
      assert.strictEqual(parseJsonInput('not json'), null);
      assert.strictEqual(parseJsonInput('{"invalid": json}'), null);
      assert.strictEqual(parseJsonInput('"string"'), 'string');
      assert.strictEqual(parseJsonInput('42'), 42);
      assert.strictEqual(parseJsonInput('true'), true);
      assert.strictEqual(parseJsonInput('null'), null);
    });
  });

  suite('objectToArray', () => {
    test('objectToArray', () => {
      assert.deepStrictEqual(objectToArray(['a', 'b', 'c']), ['a', 'b', 'c']);
      assert.deepStrictEqual(objectToArray({ key1: 'value1', key2: 'value2' }), ["'key1'", 'value1', "'key2'", 'value2']);
      assert.deepStrictEqual(objectToArray(null), []);
      assert.deepStrictEqual(objectToArray('string'), []);
      assert.deepStrictEqual(objectToArray(42), []);
      assert.deepStrictEqual(objectToArray(true), []);
      assert.deepStrictEqual(objectToArray({}), []);
      assert.deepStrictEqual(objectToArray([]), []);
      assert.deepStrictEqual(objectToArray({ 'file-content': 'ignored', key: 'value' }), ["'key'", 'value']);
      assert.deepStrictEqual(objectToArray({ 'file-content': 'ignored' }), []);
    });
  });

  suite('mergeJsonIntoArgs', () => {
    test('mergeJsonIntoArgs', () => {
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '["arg1", "arg2"]'), ['base', 'arg1', 'arg2']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '{"key1": "value1", "key2": "value2"}'), ['base', "'key1'", 'value1', "'key2'", 'value2']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], 'not json'), ['base']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '{"invalid": json}'), ['base']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '"string"'), ['base']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '42'), ['base']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], 'true'), ['base']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], 'null'), ['base']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '[1, 2, 3]'), ['base', '1', '2', '3']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '{"num": 42, "bool": true}'), ['base', "'num'", '42', "'bool'", 'true']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '[]'), ['base']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '{}'), ['base']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['cmd', '--flag'], '["arg1", "arg2"]'), ['cmd', '--flag', 'arg1', 'arg2']);
      assert.deepStrictEqual(mergeJsonIntoArgs(['base'], '{"a": {"nested": "value"}}'), ['base', "'a'", '{"nested":"value"}']);
    });
  });
});
