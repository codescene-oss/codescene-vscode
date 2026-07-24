import * as assert from 'assert';
import { initExtensionId, getExtensionId, getExtensionSettingsFilter } from '../../extension-id';

suite('Extension ID Test Suite', () => {
  test('returns default extension id before init', () => {
    assert.strictEqual(getExtensionId(), 'CodeScene.codescene-vscode');
    assert.strictEqual(getExtensionSettingsFilter(), '@ext:CodeScene.codescene-vscode');
  });

  test('initExtensionId updates getExtensionId and filter', () => {
    initExtensionId({ extension: { id: 'publisher.my-ext' } } as any);
    assert.strictEqual(getExtensionId(), 'publisher.my-ext');
    assert.strictEqual(getExtensionSettingsFilter(), '@ext:publisher.my-ext');
  });
});
