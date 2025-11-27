import * as assert from 'assert';
import Telemetry from '../../telemetry';

suite('Telemetry Test Suite', () => {
  suite('serializeErrorWithExtraData', () => {
    test('serializes error without extra data', () => {
      const error = new Error('Test error message');
      const result = Telemetry.serializeErrorWithExtraData(error);

      assert.strictEqual(result.name, 'Error');
      assert.strictEqual(result.message, 'Test error message');
      assert.ok(result.stack);
      assert.strictEqual(result.extraData, undefined);
    });

    test('serializes error with extra data', () => {
      const error = new Error('Test error message');
      const extraData = { userId: '123', action: 'click' };
      const result = Telemetry.serializeErrorWithExtraData(error, extraData);

      assert.strictEqual(result.name, 'Error');
      assert.strictEqual(result.message, 'Test error message');
      assert.ok(result.stack);
      assert.deepStrictEqual(result.extraData, extraData);
    });

    test('serializes error with code property', () => {
      const error = new Error('Network error') as any;
      error.code = 'ECONNREFUSED';
      const result = Telemetry.serializeErrorWithExtraData(error);

      assert.strictEqual(result.name, 'Error');
      assert.strictEqual(result.message, 'Network error');
      assert.strictEqual(result.code, 'ECONNREFUSED');
      assert.ok(result.stack);
    });

    test('preserves stack trace', () => {
      const error = new Error('Stack test');
      const result = Telemetry.serializeErrorWithExtraData(error);

      assert.ok(result.stack);
      assert.ok(result.stack.includes('Stack test'));
      assert.ok(result.stack.includes('at '));
    });

    test('handles empty extra data object', () => {
      const error = new Error('Test error');
      const result = Telemetry.serializeErrorWithExtraData(error, {});

      assert.strictEqual(result.name, 'Error');
      assert.strictEqual(result.message, 'Test error');
      assert.deepStrictEqual(result.extraData, {});
    });

    test('handles extra data with multiple properties', () => {
      const error = new Error('Complex test');
      const extraData = {
        userId: '456',
        timestamp: '2025-01-01T00:00:00Z',
        context: { page: 'home', feature: 'test' },
        count: 42,
      };
      const result = Telemetry.serializeErrorWithExtraData(error, extraData);

      assert.strictEqual(result.name, 'Error');
      assert.strictEqual(result.message, 'Complex test');
      assert.deepStrictEqual(result.extraData, extraData);
      assert.ok(result.stack);
    });
  });
});
