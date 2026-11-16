import * as assert from 'assert';
import { RefactorResponse } from '../../devtools-api/refactor-models';
import { decorateCode, refactoringStaleness } from '../../refactoring/utils';
import { RefactoringRequest } from '../../refactoring/request';
import { fnToRefactorForWholeFile } from '../../refactoring/fn-to-refactor';
import { TestTextDocument } from '../mocks/test-text-document';
import { FixGoalTarget } from '../../refactoring/agent-types';

const originalCode = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';

suite('Refactor utils Test Suite', () => {
  const refactorResponse: RefactorResponse = {
    code: originalCode,
    reasons: [],
    'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
    confidence: { level: 3, 'recommended-action': { description: '', details: '' }, title: '' },
    metadata: {},
    'trace-id': 'trace-id',
  };

  test("Return code as is if there's no reasons-with-details", async () => {
    const code = decorateCode(refactorResponse, 'javascript');
    assert.equal(code, originalCode);
  });

  test('Return code with decorations if there are reasons-with-details containing linter info', async () => {
    refactorResponse.reasons = [{ summary: 'Issue 1', details: [{ message: 'Issue 1', lines: [1], columns: [1] }] }];
    let code = decorateCode(refactorResponse, 'javascript');
    assert.equal(code, 'const a = 1;\n// ⚠️ Issue 1\nconst b = 2;\nconst c = 3;\n');
    refactorResponse.reasons = [
      { summary: 'Issue 1', details: [{ message: 'Issue 1', lines: [0], columns: [1] }] },
      { summary: 'Issue 2', details: [{ message: 'Issue 2', lines: [2], columns: [1] }] },
    ];

    code = decorateCode(refactorResponse, 'javascript');
    assert.equal(code, '// ⚠️ Issue 1\nconst a = 1;\nconst b = 2;\n// ⚠️ Issue 2\nconst c = 3;\n');
  });

  test('Handle reason-with-details with multiline messages', async () => {
    refactorResponse.reasons = [
      { summary: 'Issue 1', details: [{ message: 'Issue 1\nThis is weird', lines: [1], columns: [1] }] },
      { summary: 'Issue 2', details: [{ message: 'Issue 2', lines: [2], columns: [1] }] },
    ];
    let code = decorateCode(refactorResponse, 'javascript');
    assert.equal(code, 'const a = 1;\n// ⚠️ Issue 1\n// This is weird\nconst b = 2;\n// ⚠️ Issue 2\nconst c = 3;\n');
  });

  const goal: FixGoalTarget = {
    goalId: 1,
    metricId: 'code-health',
    operator: 'greater-than',
    target: 8.0,
    baseline: 6.0,
    repoRoot: '/repo',
    path: 'file.ts',
  };

  function requestFor(c: { original: string; now: string; goal: boolean }) {
    const document = new TestTextDocument('/repo/file.ts', c.now, 'typescript');
    const fnToRefactor = fnToRefactorForWholeFile(new TestTextDocument('/repo/file.ts', c.original, 'typescript'));
    return new RefactoringRequest(fnToRefactor, document, false, c.goal ? goal : undefined);
  }

  for (const c of [
    { name: 'goal, unchanged', original: 'a\nb\n', now: 'a\nb\n', goal: true, stale: false },
    { name: 'goal, a line appended', original: 'a\nb\n', now: 'a\nb\nc\n', goal: true, stale: true },
    { name: 'goal, a line prepended', original: 'a\nb\n', now: 'z\na\nb\n', goal: true, stale: true },
    { name: 'goal, edited inside', original: 'a\nb\n', now: 'a\nX\n', goal: true, stale: true },
    { name: 'smell, a line appended', original: 'a\nb\n', now: 'a\nb\nc\n', goal: false, stale: false },
  ]) test(`refactoringStaleness ${c.name}`, () => assert.strictEqual(refactoringStaleness(requestFor(c)).isStale, c.stale));
});
