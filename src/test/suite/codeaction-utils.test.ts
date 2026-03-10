import * as assert from 'assert';
import {
  buildDisableAnnotation,
  getLineIndentation,
  buildInsertText
} from '../../utils/codeaction-utils';

suite('CodeAction Utils', () => {
  suite('buildDisableAnnotation', () => {
    test('creates annotation with category', () => {
      const result = buildDisableAnnotation('complex-conditional');
      assert.strictEqual(result, '@CodeScene(disable:"complex-conditional")');
    });

    test('handles category with special characters', () => {
      const result = buildDisableAnnotation('deep-nesting/loops');
      assert.strictEqual(result, '@CodeScene(disable:"deep-nesting/loops")');
    });
  });

  suite('getLineIndentation', () => {
    test('extracts no indentation', () => {
      const result = getLineIndentation('const x = 1;');
      assert.strictEqual(result, '');
    });

    test('extracts space indentation', () => {
      const result = getLineIndentation('    const x = 1;');
      assert.strictEqual(result, '    ');
    });

    test('extracts tab indentation', () => {
      const result = getLineIndentation('\t\tconst x = 1;');
      assert.strictEqual(result, '\t\t');
    });

    test('extracts mixed indentation', () => {
      const result = getLineIndentation('\t  const x = 1;');
      assert.strictEqual(result, '\t  ');
    });

    test('handles empty line', () => {
      const result = getLineIndentation('');
      assert.strictEqual(result, '');
    });
  });

  suite('buildInsertText', () => {
    test('builds text with no indentation', () => {
      const result = buildInsertText('test-category', '');
      assert.strictEqual(result, '@CodeScene(disable:"test-category")\n');
    });

    test('builds text with space indentation', () => {
      const result = buildInsertText('test-category', '  ');
      assert.strictEqual(result, '  @CodeScene(disable:"test-category")\n');
    });

    test('builds text with tab indentation', () => {
      const result = buildInsertText('test-category', '\t');
      assert.strictEqual(result, '\t@CodeScene(disable:"test-category")\n');
    });
  });
});
