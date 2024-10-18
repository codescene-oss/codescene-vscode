import * as assert from 'assert';
import { RefactorResponse } from '../../refactoring/model';
import { decorateCode } from '../../refactoring/utils';

const originalCode = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';

suite('Refactor utils Test Suite', () => {
  const refactorResponse: RefactorResponse = {
    code: originalCode,
    'reasons-with-details': [],
    'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
    confidence: { level: 3, 'recommended-action': { description: '', details: '' }, description: '', title: '' },
  };

  test("Return code as is if there's no reasons-with-details", async () => {
    const code = decorateCode(refactorResponse, 'javascript');
    assert.equal(code, originalCode);
  });

  test('Return code with decorations if there are reasons-with-details containing linter info', async () => {
    refactorResponse['reasons-with-details'] = [
      { summary: 'Issue 1', details: [{ message: 'Issue 1', lines: [1], columns: [1] }] },
    ];
    let code = decorateCode(refactorResponse, 'javascript');
    assert.equal(code, 'const a = 1;\n// ⚠️ Issue 1\nconst b = 2;\nconst c = 3;\n');
    refactorResponse['reasons-with-details'] = [
      { summary: 'Issue 1', details: [{ message: 'Issue 1', lines: [0], columns: [1] }] },
      { summary: 'Issue 2', details: [{ message: 'Issue 2', lines: [2], columns: [1] }] },
    ];

    code = decorateCode(refactorResponse, 'javascript');
    assert.equal(code, '// ⚠️ Issue 1\nconst a = 1;\nconst b = 2;\n// ⚠️ Issue 2\nconst c = 3;\n');
  });

  test('Handle reason-with-details with multiline messages', async () => {
    refactorResponse['reasons-with-details'] = [
      { summary: 'Issue 1', details: [{ message: 'Issue 1\nThis is weird', lines: [1], columns: [1] }] },
      { summary: 'Issue 2', details: [{ message: 'Issue 2', lines: [2], columns: [1] }] },
    ];
    let code = decorateCode(refactorResponse, 'javascript');
    assert.equal(code, 'const a = 1;\n// ⚠️ Issue 1\n// This is weird\nconst b = 2;\n// ⚠️ Issue 2\nconst c = 3;\n');
  });
});
