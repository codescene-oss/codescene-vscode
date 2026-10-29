import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChangeType, FunctionFinding } from '../../devtools-api/delta-model';
import { CodeSmell, Review } from '../../devtools-api/review-model';
import { fnToRefactorForCodeSmell, fnToRefactorForFinding } from '../../refactoring/fn-to-refactor';
import { TestTextDocument } from '../mocks/test-text-document';

const content = 'const a = 1;\nfunction f(x) {\n  return x;\n}\n';
const document = new TestTextDocument('/repo/src/file.ts', content, 'typescript');

function smell(category: string, startLine: number, endLine: number): CodeSmell {
  return {
    category,
    details: '',
    'highlight-range': { 'start-line': startLine, 'start-column': 1, 'end-line': endLine, 'end-column': 2 },
  };
}

const complexMethod = smell('Complex Method', 2, 2);
const lowCohesion = smell('Low Cohesion', 1, 1);

const review: Review = {
  'file-level-code-smells': [lowCohesion],
  'function-level-code-smells': [
    {
      function: 'f',
      range: { 'start-line': 2, 'start-column': 1, 'end-line': 4, 'end-column': 2 },
      'code-smells': [complexMethod],
    },
  ],
  'raw-score': 'raw',
};

suite('fnToRefactorForCodeSmell', () => {
  const cases = [
    {
      name: 'uses the enclosing function for function-level smells',
      codeSmell: complexMethod,
      review,
      expected: {
        name: 'f',
        body: 'function f(x) {\n  return x;\n}',
        range: { 'start-line': 2, 'start-column': 1, 'end-line': 4, 'end-column': 2 },
        vscodeRange: new vscode.Range(1, 0, 3, 1),
        targets: [{ category: 'Complex Method', line: 2 }],
      },
    },
    {
      name: 'uses the whole file for file-level smells',
      codeSmell: lowCohesion,
      review,
      expected: {
        name: 'file.ts',
        body: content,
        range: { 'start-line': 1, 'start-column': 1, 'end-line': 5, 'end-column': 1 },
        vscodeRange: new vscode.Range(0, 0, 4, 0),
        targets: [{ category: 'Low Cohesion', line: 1 }],
      },
    },
    {
      name: 'uses the whole file when no review is available',
      codeSmell: complexMethod,
      review: undefined,
      expected: {
        name: 'file.ts',
        body: content,
        range: { 'start-line': 1, 'start-column': 1, 'end-line': 5, 'end-column': 1 },
        vscodeRange: new vscode.Range(0, 0, 4, 0),
        targets: [{ category: 'Complex Method', line: 2 }],
      },
    },
  ];

  cases.forEach(({ name, codeSmell, review, expected }) => {
    test(name, () => {
      const fn = fnToRefactorForCodeSmell(document, codeSmell, review);
      assert.strictEqual(fn.name, expected.name);
      assert.strictEqual(fn.body, expected.body);
      assert.strictEqual(fn['file-type'], 'ts');
      assert.deepStrictEqual(fn.range, expected.range);
      assert.deepStrictEqual(fn.vscodeRange, expected.vscodeRange);
      assert.deepStrictEqual(fn['refactoring-targets'], expected.targets);
    });
  });
});

suite('fnToRefactorForFinding', () => {
  const functionRange = { 'start-line': 2, 'start-column': 1, 'end-line': 4, 'end-column': 2 };

  function finding(changeDetails: FunctionFinding['change-details'], range = functionRange): FunctionFinding {
    return { function: { name: 'f', range }, 'change-details': changeDetails };
  }

  const detail = (category: string, changeType: ChangeType, line?: number) => ({
    category,
    'change-type': changeType,
    description: '',
    line,
  });

  const cases = [
    {
      name: 'targets every remaining smell in the function',
      finding: finding([
        detail('Complex Method', ChangeType.Introduced, 2),
        detail('Bumpy Road Ahead', ChangeType.Improved, 3),
        detail('Large Method', ChangeType.Fixed, 2),
      ]),
      expectedTargets: [
        { category: 'Complex Method', line: 2 },
        { category: 'Bumpy Road Ahead', line: 3 },
      ],
    },
    {
      name: 'is not refactorable when every smell was fixed',
      finding: finding([detail('Complex Method', ChangeType.Fixed, 2)]),
      expectedTargets: undefined,
    },
    {
      name: 'skips changes without a line',
      finding: finding([detail('Complex Method', ChangeType.Degraded)]),
      expectedTargets: undefined,
    },
    {
      name: 'is not refactorable without a function range',
      finding: { function: { name: 'f' }, 'change-details': [detail('Complex Method', ChangeType.Degraded, 2)] },
      expectedTargets: undefined,
    },
  ];

  cases.forEach(({ name, finding, expectedTargets }) => {
    test(name, () => {
      const fn = fnToRefactorForFinding(document, finding);
      assert.deepStrictEqual(fn?.['refactoring-targets'], expectedTargets);
      if (fn) {
        assert.strictEqual(fn.name, 'f');
        assert.strictEqual(fn.body, 'function f(x) {\n  return x;\n}');
      }
    });
  });
});
