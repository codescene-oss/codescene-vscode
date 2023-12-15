import * as assert from 'assert';
import * as vscode from 'vscode';
import { ReviewIssue } from '../../review/model';
import { reviewIssueToDiagnostics } from '../../review/review-utils';


suite('reviewIssueToDiagnostics', () => {
  test('returns info diagnostic for document level issues', async () => {
    const reviewIssue: ReviewIssue = {
      category: 'Primitive Obsession',
      description: 'Test description',
    };

    const document = await vscode.workspace.openTextDocument({
      content: 'Sample content',
      language: 'typescript',
    });

    const diagnostics = reviewIssueToDiagnostics(reviewIssue, document);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Information);
    assert.strictEqual(diagnostics[0].message, 'Primitive Obsession');
    assert.strictEqual(diagnostics[0].range.start.line, 0);
    assert.strictEqual(diagnostics[0].range.end.line, 0);
  });

  test('returns warning diagnostic for function level issues', async () => {
    const reviewIssue: ReviewIssue = {
      category: 'Complex Method',
      description: 'Test description',
      functions: [
        {
          details: 'cc = 3',
          title: 'foo',
          'start-line': 1,
          'end-line': 1,
        },
      ],
    };

    const document = await vscode.workspace.openTextDocument({
      content: 'function foo() { return 1 + 2; }',
      language: 'typescript',
    });

    const diagnostics = reviewIssueToDiagnostics(reviewIssue, document);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
    assert.strictEqual(diagnostics[0].message, 'Complex Method (cc = 3)');
    assert.strictEqual(diagnostics[0].range.start.line, 0);
    assert.strictEqual(diagnostics[0].range.end.line, 0);
    assert.strictEqual(diagnostics[0].range.start.character, 9);
    assert.strictEqual(diagnostics[0].range.end.character, 12);
  });

  test('handles case where function name cannot be found', async () => {
    const reviewIssue: ReviewIssue = {
        category: 'Complex Method',
        description: 'Test description',
        functions: [
          {
            details: 'cc = 3',
            title: 'foobar',
            'start-line': 1,
            'end-line': 1,
          },
        ],
      };

    const document = await vscode.workspace.openTextDocument({
        content: 'function foo() { return 1 + 2; }',
        language: 'typescript',
    });

    const diagnostics = reviewIssueToDiagnostics(reviewIssue, document);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
    assert.strictEqual(diagnostics[0].message, 'Complex Method (cc = 3)');

    // In this case the position of the range is just the start of the line
    assert.strictEqual(diagnostics[0].range.start.line, 0);
    assert.strictEqual(diagnostics[0].range.end.line, 0);
    assert.strictEqual(diagnostics[0].range.start.character, 0);
    assert.strictEqual(diagnostics[0].range.end.character, 0);
  });

  test('handles complex conditional', async () => {
    const reviewIssue: ReviewIssue = {
        category: 'Complex Conditional',
        description: 'Test description',
        functions: [
            {
                details: '2 complex conditional expressions',
                title: 'foo',
                'start-line': 2,
                'end-line': 2,
            },
        ],
    };

    const document = await vscode.workspace.openTextDocument({
        content: `function foo() {
  if (a && b && c) {
    return 1;
  }
}`,
        language: 'typescript',
    });

    const diagnostics = reviewIssueToDiagnostics(reviewIssue, document);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
    assert.strictEqual(diagnostics[0].message, 'Complex Conditional (2 complex conditional expressions)');
    assert.strictEqual(diagnostics[0].range.start.line, 1);
    assert.strictEqual(diagnostics[0].range.end.line, 2);
    assert.strictEqual(diagnostics[0].range.start.character, 2);
    assert.strictEqual(diagnostics[0].range.end.character, 0);
  });

  test('handles multi-line complex conditional', async () => {
    const reviewIssue: ReviewIssue = {
        category: 'Complex Conditional',
        description: 'Test description',
        functions: [
            {
                details: '2 complex conditional expressions',
                title: 'foo',
                'start-line': 2,
                'end-line': 3,
            },
        ],
    };

    const document = await vscode.workspace.openTextDocument({
        content: `function foo() {
  if (a && b && c ||
      d) {
    return 1;
  }
}`,
        language: 'typescript',
    });

    const diagnostics = reviewIssueToDiagnostics(reviewIssue, document);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
    assert.strictEqual(diagnostics[0].message, 'Complex Conditional (2 complex conditional expressions)');
    assert.strictEqual(diagnostics[0].range.start.line, 1);
    assert.strictEqual(diagnostics[0].range.end.line, 3);
    assert.strictEqual(diagnostics[0].range.start.character, 2);
    assert.strictEqual(diagnostics[0].range.end.character, 0);
  });
});
