import assert from 'assert';
import { CodeSmell, Range, Function, Review } from '../../devtools-api/review-model';
import { reviewFunctionToDiagnostics, reviewResultToDiagnostics } from '../../review/utils';
import { openTextDocument, DiagnosticSeverity } from '../mocks/vscode';

suite('reviewIssueToDiagnostics', () => {
  const fileCodeSmellRange: Range = {
    'start-line': 1,
    'start-column': 1,
    'end-line': 1,
    'end-column': 1,
  };

  const fileCodeSmell: CodeSmell = {
    category: 'Large number of lines',
    details: 'test details',
    'highlight-range': fileCodeSmellRange,
  };

  const functionCodeSmellRange: Range = {
    'start-line': 15,
    'start-column': 20,
    'end-line': 15,
    'end-column': 40,
  };

  const functionCodeSmell: Function = {
    function: 'foo',
    range: functionCodeSmellRange,
    'code-smells': [
      {
        category: 'Primitive Obsession',
        details: 'cc = 3',
        'highlight-range': functionCodeSmellRange,
      },
    ],
  };

  const expressionCodeSmellRange: Range = {
    'start-line': 2,
    'start-column': 3,
    'end-line': 4,
    'end-column': 1,
  };

  const expressionCodeSmell: CodeSmell = {
    category: 'Complex Conditional',
    details: '2 complex conditional expressions',
    'highlight-range': expressionCodeSmellRange,
  };

  test('returns info diagnostic for document level issues', async () => {
    const document = await openTextDocument({
      content: 'Sample content',
      language: 'typescript',
    });

    const diagnostics = reviewFunctionToDiagnostics(functionCodeSmell, document);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Warning);
    assert.strictEqual(diagnostics[0].message, 'Primitive Obsession (cc = 3)');
    assert.strictEqual(diagnostics[0].range.start.line, functionCodeSmellRange['start-line'] - 1);
    assert.strictEqual(diagnostics[0].range.end.line, functionCodeSmellRange['end-line'] - 1);
    assert.strictEqual(diagnostics[0].range.start.character, functionCodeSmellRange['start-column'] - 1);
    assert.strictEqual(diagnostics[0].range.end.character, functionCodeSmellRange['end-column'] - 1);
  });

  test('handles multi-line complex conditional', async () => {
    const reviewResult: Review = {
      score: 9.81,
      'file-level-code-smells': [],
      'function-level-code-smells': [
        {
          function: 'foo',
          range: functionCodeSmellRange,
          'code-smells': [expressionCodeSmell],
        },
      ],
      'raw-score': '',
    };

    const document = await openTextDocument({
      content: `function foo() {
                  if (a && b && c ||
                      d) {
                    return 1;
                  }
                }`,
      language: 'typescript',
    });

    const diagnostics = reviewResultToDiagnostics(reviewResult, document);
    assert.strictEqual(diagnostics.length, 1);

    assert.strictEqual(diagnostics[0].message, 'Complex Conditional (2 complex conditional expressions)');
    assert.strictEqual(diagnostics[0].range.start.line, expressionCodeSmellRange['start-line'] - 1);
    assert.strictEqual(diagnostics[0].range.end.line, expressionCodeSmellRange['end-line'] - 1);
    assert.strictEqual(diagnostics[0].range.start.character, expressionCodeSmellRange['start-column'] - 1);
    assert.strictEqual(diagnostics[0].range.end.character, expressionCodeSmellRange['end-column'] - 1);
    assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Warning, 'Wrong severity');
  });

  test('handles file and function level code smells', async () => {
    const reviewResult: Review = {
      score: 9.81,
      'file-level-code-smells': [fileCodeSmell],
      'function-level-code-smells': [functionCodeSmell],
      'raw-score': '',
    };
    const document = await openTextDocument({
      content: `function foo() {
                  if (a && b && c ||
                      d) {
                    return 1;
                  }
                }`,
      language: 'typescript',
    });

    const diagnostics = reviewResultToDiagnostics(reviewResult, document);
    assert.strictEqual(diagnostics.length, 2);

    for (const d of diagnostics) {
      let expectedRange;
      let expectedSeverity;
      if (d.message === 'Complex Conditional (2 complex conditional expressions)') {
        expectedRange = expressionCodeSmellRange;
        expectedSeverity = DiagnosticSeverity.Warning;
      } else if (d.message === 'Primitive Obsession (cc = 3)') {
        expectedRange = functionCodeSmellRange;
        expectedSeverity = DiagnosticSeverity.Warning;
      } else if (d.message === 'Large number of lines (test details)') {
        expectedRange = fileCodeSmellRange;
        expectedSeverity = DiagnosticSeverity.Warning;
      }
      assert.ok(expectedRange, 'Range should be defined if it matches any of the expected message: ' + d.message);
      assert.ok(
        expectedSeverity,
        'Severity should be defined if it matches any of the expected messages: ' + d.message
      );

      assert.strictEqual(d.range.start.line, expectedRange['start-line'] - 1);
      assert.strictEqual(d.range.end.line, expectedRange['end-line'] - 1);
      assert.strictEqual(d.range.start.character, expectedRange['start-column'] - 1);
      assert.strictEqual(d.range.end.character, expectedRange['end-column'] - 1);
      assert.strictEqual(d.severity, expectedSeverity);
    }
  });
});
