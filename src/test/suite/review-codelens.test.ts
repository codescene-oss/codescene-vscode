import assert from 'assert';
import { Delta } from '../../devtools-api/delta-model';
import { codeHealthCodeLensTitle } from '../../review/codelens';

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
});
