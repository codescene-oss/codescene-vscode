import * as assert from 'assert';
import { isSafeRefName } from '../../git-utils';

suite('Git Utils Test Suite', () => {
  suite('isSafeRefName', () => {
    test('accepts valid branch names', () => {
      assert.strictEqual(isSafeRefName('main'), true);
      assert.strictEqual(isSafeRefName('master'), true);
      assert.strictEqual(isSafeRefName('feature/my-feature'), true);
      assert.strictEqual(isSafeRefName('bugfix-123'), true);
      assert.strictEqual(isSafeRefName('release_1.2.0'), true);
      assert.strictEqual(isSafeRefName('develop'), true);
      assert.strictEqual(isSafeRefName('user/feature/branch'), true);
    });

    test('rejects option-like names (leading dash)', () => {
      assert.strictEqual(isSafeRefName('--upload-pack=evil'), false);
      assert.strictEqual(isSafeRefName('-n'), false);
      assert.strictEqual(isSafeRefName('--exec=cmd'), false);
    });

    test('rejects empty or whitespace-only names', () => {
      assert.strictEqual(isSafeRefName(''), false);
      assert.strictEqual(isSafeRefName('   '), false);
    });

    test('rejects names with whitespace or control characters', () => {
      assert.strictEqual(isSafeRefName('branch name'), false);
      assert.strictEqual(isSafeRefName('branch\tname'), false);
      assert.strictEqual(isSafeRefName('branch\nname'), false);
    });

    test('rejects names with special shell characters', () => {
      assert.strictEqual(isSafeRefName('branch;echo'), false);
      assert.strictEqual(isSafeRefName('branch|pipe'), false);
      assert.strictEqual(isSafeRefName('branch$(cmd)'), false);
      assert.strictEqual(isSafeRefName('branch`cmd`'), false);
    });
  });
});
