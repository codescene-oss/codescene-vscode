import assert from 'assert';
import * as vscode from 'vscode';
import { Delta } from '../../devtools-api/delta-model';
import { ReviewCodeActionProvider } from '../../review/codeaction';
import { codeHealthCodeLensTitle, CsReviewCodeLensProvider } from '../../review/codelens';
import Reviewer from '../../review/reviewer';
import { TestTextDocument } from '../mocks/test-text-document';

function delta(overrides: Partial<Delta>): Delta {
  return {
    'file-level-findings': [],
    'function-level-findings': [],
    'score-change': 0,
    ...overrides,
  };
}

suite('Review CodeLens', () => {
  const testCases = [
    {
      name: 'shows the new score when there is no old score',
      input: delta({ 'new-score': 9.68, 'score-change': -0.32 }),
      expected: 'Code Health: 9.68/10',
    },
    {
      name: 'shows the score change when old and new scores differ',
      input: delta({ 'old-score': 9, 'new-score': 8, 'score-change': -1 }),
      expected: 'Code Health: 9 → 8',
    },
    {
      name: 'shows the unchanged score when old and new scores are equal',
      input: delta({ 'old-score': 9, 'new-score': 9, 'score-change': 0 }),
      expected: 'Code Health: 9/10',
    },
  ];

  testCases.forEach(({ name, input, expected }) => {
    test(name, () => {
      assert.strictEqual(codeHealthCodeLensTitle(input), expected);
    });
  });

  test('provideCodeLenses does not throw when Reviewer is not initialized', async () => {
    const previous = (Reviewer as any)._instance;
    (Reviewer as any)._instance = undefined;
    const provider = new CsReviewCodeLensProvider();
    try {
      const document = new TestTextDocument('/test/file.ts', 'const x = 1;', 'typescript');
      const lenses = await provider.provideCodeLenses(document, undefined as unknown as vscode.CancellationToken);
      assert.strictEqual(lenses, undefined);
    } finally {
      provider.dispose();
      (Reviewer as any)._instance = previous;
    }
  });

  test('provideCodeActions does not throw when Reviewer is not initialized', async () => {
    const previous = (Reviewer as any)._instance;
    (Reviewer as any)._instance = undefined;
    const provider = new ReviewCodeActionProvider();
    try {
      const document = new TestTextDocument('/test/file.ts', 'const x = 1;', 'typescript');
      const range = new vscode.Range(0, 0, 0, 1);
      const context = { diagnostics: [], triggerKind: 1, only: undefined } as vscode.CodeActionContext;
      const actions = await provider.provideCodeActions(
        document,
        range,
        context,
        undefined as unknown as vscode.CancellationToken
      );
      assert.strictEqual(actions, undefined);
    } finally {
      provider.dispose();
      (Reviewer as any)._instance = previous;
    }
  });
});
