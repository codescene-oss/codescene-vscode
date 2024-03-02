import * as assert from 'assert';
import { decorateCode } from '../../refactoring/utils';

const originalCode = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';

suite('Refactor utils Test Suite', () => {
  test("Return code as is if there's no reasons-with-details", async () => {
    const code = decorateCode(originalCode, 'javascript', []);
    assert.equal(code, originalCode);
  });

  test('Return code with decorations if there are reasons-with-details containing linter info', async () => {
    let code = decorateCode(originalCode, 'javascript', [
      { summary: 'Issue 1', details: [{ message: 'Issue 1', lines: [1], columns: [1] }] },
    ]);
    assert.equal(code, 'const a = 1;\n// ⚠️ Issue 1\nconst b = 2;\nconst c = 3;\n');

    code = decorateCode(originalCode, 'javascript', [
      { summary: 'Issue 1', details: [{ message: 'Issue 1', lines: [0], columns: [1] }] },
      { summary: 'Issue 2', details: [{ message: 'Issue 2', lines: [2], columns: [1] }] },
    ]);
    assert.equal(code, '// ⚠️ Issue 1\nconst a = 1;\nconst b = 2;\n// ⚠️ Issue 2\nconst c = 3;\n');
  });

  test('Handle reason-with-details with multiline messages', async () => {
    let code = decorateCode(originalCode, 'javascript', [
      { summary: 'Issue 1', details: [{ message: 'Issue 1\nThis is weird', lines: [1], columns: [1] }] },
      { summary: 'Issue 2', details: [{ message: 'Issue 2', lines: [2], columns: [1] }] },
    ]);
    assert.equal(code, 'const a = 1;\n// ⚠️ Issue 1\n// This is weird\nconst b = 2;\n// ⚠️ Issue 2\nconst c = 3;\n');
  });
});
