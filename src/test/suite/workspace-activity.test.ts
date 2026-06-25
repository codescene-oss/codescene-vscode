import * as assert from 'assert';
import {
  consumeWorkspaceFileActivity,
  markWorkspaceFileActivity,
  resetWorkspaceFileActivity,
} from '../../git/workspace-activity';

suite('workspace-activity Test Suite', () => {
  setup(() => {
    resetWorkspaceFileActivity();
  });

  test('consumeWorkspaceFileActivity returns false when no activity was marked', () => {
    assert.strictEqual(consumeWorkspaceFileActivity(), false);
  });

  test('consumeWorkspaceFileActivity returns true once after markWorkspaceFileActivity', () => {
    markWorkspaceFileActivity();
    assert.strictEqual(consumeWorkspaceFileActivity(), true);
    assert.strictEqual(consumeWorkspaceFileActivity(), false);
  });

  test('resetWorkspaceFileActivity clears pending activity', () => {
    markWorkspaceFileActivity();
    resetWorkspaceFileActivity();
    assert.strictEqual(consumeWorkspaceFileActivity(), false);
  });
});
