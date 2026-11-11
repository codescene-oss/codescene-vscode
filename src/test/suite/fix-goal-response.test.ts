import * as assert from 'assert';
import { FixGoalTarget, FixGoalOutput } from '../../refactoring/agent-types';
import { meetsTarget, formatScore, fixGoalCode, mapFixGoalResponse } from '../../refactoring/fix-goal-response';

suite('Fix goal response Test Suite', () => {
  const goal: FixGoalTarget = { goalId: 2, metricId: 'average-code-health', operator: 'greater-than-or-equal', target: 8, baseline: 6.2, repoRoot: '/repo', path: 'src/a.ts' };
  const output = (over: Partial<FixGoalOutput> = {}): FixGoalOutput => ({ schema_version: '1.0', task_id: 't-1', fix_result: 'improved', confidence: 'medium', explanation: 'Complex Method in parse() needs a parser split.', whole_file_content: 'b\n', generated_at: '2026-11-11T00:00:00Z', ...over });

  for (const c of [
    { score: 8, operator: 'greater-than-or-equal', target: 8, met: true },
    { score: 7.99, operator: 'greater-than-or-equal', target: 8, met: false },
    { score: 8, operator: 'greater-than', target: 8, met: false },
    { score: 8.01, operator: 'greater-than', target: 8, met: true },
    { score: 10, operator: 'less-than', target: 8, met: false },
    { score: 10, operator: '', target: 8, met: false },
  ]) {
    test(`meetsTarget ${c.score} ${c.operator || '<none>'} ${c.target} is ${c.met}`, () => assert.strictEqual(meetsTarget(c.score, c.operator, c.target), c.met));
  }

  for (const [score, text] of [[8, '8.0'], [8.1, '8.1'], [7.96, '7.96'], [7.999, '8.0'], [6.25, '6.25']] as const) {
    test(`formatScore ${score} is ${text}`, () => assert.strictEqual(formatScore(score), text));
  }

  for (const c of [
    { name: 'LF output for an LF file is kept', body: 'a\n', content: 'b\n', code: 'b\n' },
    { name: 'LF output for a CRLF file gets CRLF', body: 'a\r\nb\r\n', content: 'a\nc\n', code: 'a\r\nc\r\n' },
    { name: 'mixed output for a CRLF file is all CRLF', body: 'a\r\n', content: 'a\r\nc\n', code: 'a\r\nc\r\n' },
    { name: 'missing content keeps the original', body: 'a\r\n', content: undefined, code: 'a\r\n' },
    { name: 'empty content keeps the original', body: 'a\n', content: '', code: 'a\n' },
  ]) {
    test(`fixGoalCode: ${c.name}`, () => assert.strictEqual(fixGoalCode(output({ whole_file_content: c.content }), c.body), c.code));
  }

  for (const c of [
    { reached: 8.1, outcome: 'reached', level: 3, details: 'Goal reached: 6.2 → 8.1 (target 8.0)', header: 'What was changed' },
    { reached: 7.5, outcome: 'improved', level: 2, details: 'Improved: 6.2 → 7.5 (target 8.0)', header: 'Why the target was not reached' },
    { reached: 6.2, outcome: 'unable', level: 1, details: output().explanation, header: 'Why the target was not reached' },
    { reached: 5.9, outcome: 'unable', level: 1, details: output().explanation, header: 'Why the target was not reached' },
    { reached: undefined, outcome: 'unable', level: 1, details: output().explanation, header: 'Why the target was not reached' },
  ]) {
    test(`mapFixGoalResponse with reached ${c.reached} is ${c.outcome}`, () => {
      const response = mapFixGoalResponse(output(), goal, 'b\n', c.reached);
      assert.deepStrictEqual(
        { outcome: response['goal-outcome'], level: response.confidence.level, details: response.confidence['recommended-action'].details, header: response.confidence['review-header'], reasons: response.reasons, code: response.code, trace: response['trace-id'] },
        { outcome: c.outcome, level: c.level, details: c.details, header: c.header, reasons: [{ summary: output().explanation }], code: 'b\n', trace: 't-1' }
      );
    });
  }

  test('mapFixGoalResponse with an unknown operator offers the improvement but never claims the goal', () => {
    const response = mapFixGoalResponse(output(), { ...goal, operator: 'at-least' }, 'b\n', 9.5);
    assert.deepStrictEqual([response['goal-outcome'], response.confidence.level], ['improved', 2]);
  });

  test('mapFixGoalResponse lists no reason for a blank explanation', () => {
    assert.deepStrictEqual(mapFixGoalResponse(output({ explanation: '  ' }), goal, 'b\n', 8.1).reasons, []);
  });
});
