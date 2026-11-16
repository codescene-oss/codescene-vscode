import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentRefactoringService, agentArgs } from '../../refactoring/agent-service';
import { AgentOutput, ConfidenceLevel, ScoreGoalTarget, FixGoalOutput, FindingGoalTarget, GoalFinding } from '../../refactoring/agent-types';
import { FnToRefactor, RefactorResponse } from '../../devtools-api/refactor-models';
import { Review } from '../../devtools-api/review-model';
import { findingTargets } from '../../refactoring/fn-to-refactor';
import { aceSuite } from '../ace-test-suite';
import { Range, Position } from '../mocks/vscode';
import { RENDER_CODE_FIX_SKILL, FIX_GOAL_SKILL } from '../../refactoring/agent-config';
import { AbortError } from '../../devtools-api/abort-error';

const fixturesDir = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'agent-output');

function loadFixture(name: string): AgentOutput {
  const content = fs.readFileSync(path.join(fixturesDir, name), 'utf-8');
  return JSON.parse(content);
}

function createMockFnToRefactor(body: string): FnToRefactor {
  return {
    name: 'testFunction',
    body,
    'file-type': 'typescript',
    range: {
      'start-line': 1,
      'start-column': 1,
      'end-line': 10,
      'end-column': 2,
    },
    'refactoring-targets': [{ category: 'Deep, Nested Complexity', line: 1 }],
    vscodeRange: new Range(new Position(0, 0), new Position(9, 1)) as any,
  };
}

function createMockDocument(fileName: string, content: string) {
  return {
    fileName,
    getText: () => content,
    uri: { fsPath: fileName },
  } as any;
}

aceSuite('AgentRefactoringService Test Suite', () => {
  for (const { skill, expected } of [
    { skill: RENDER_CODE_FIX_SKILL, expected: ['run', 'skill:render-code-fix', '--model', 'm'] },
    { skill: FIX_GOAL_SKILL, expected: ['run', 'skill:fix-goal', '--model', 'm'] },
  ]) {
    test(`agentArgs runs skill ${skill.name}`, () => assert.deepStrictEqual(agentArgs(skill, 'm'), expected));
  }

  test('buildFixGoalInput writes the goal of the file, relative to the repository', () => {
    const goal: ScoreGoalTarget = { goalId: 2, metricId: 'average-code-health', operator: 'greater-than-or-equal', target: 9, baseline: 6, repoRoot: 'C:\\work\\fake-repo', path: 'src/orders.js' };
    assert.deepStrictEqual(AgentRefactoringService.buildFixGoalInput(goal, 'fix-goal-1'), {
      '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
      task_id: 'fix-goal-1',
      file: 'src/orders.js',
      goal: { id: 2, 'metric-id': 'average-code-health', operator: 'greater-than-or-equal', target: 9 },
      baseline: 6,
    });
  });

  test('readOutput reports the end of stderr when the agent wrote no output file', () => {
    const missing = path.join(os.tmpdir(), `cs-agent-missing-${Date.now()}`, FIX_GOAL_SKILL.outputFile);
    assert.throws(() => AgentRefactoringService.readOutput(missing, 'line1\nboom'), /Agent did not produce output file: line1\nboom/);
  });

  const testCases = [
    {
      name: 'mapOutputToResponse maps fix_proposed correctly',
      fixture: 'fix-proposed.json',
      fnBody: 'function test(a: number) {\n  if (a > 0) {\n    if (a > 1) {\n      return a;\n    }\n  }\n  return 0;\n}',
      assertions: (response: any, output: AgentOutput) => {
        assert.strictEqual(response['trace-id'], output.task_id);
        assert.strictEqual(response.confidence.level, 3);
        assert.strictEqual(response.confidence.title, output.summary);
        assert.strictEqual(response.confidence['recommended-action'].details, output.reasoning);
        assert.strictEqual(response.reasons.length, 0);
        assert.deepStrictEqual(response['refactoring-properties']['removed-code-smells'], ['Deep, Nested Complexity']);
      },
    },
    {
      name: 'mapOutputToResponse maps unable_to_fix correctly',
      fixture: 'unable-to-fix.json',
      fnBody: 'function complex() { return 42; }',
      assertions: (response: any) => {
        assert.strictEqual(response.confidence.level, 1);
        assert.strictEqual(response.confidence.title, 'Unable to refactor');
        assert.strictEqual(response.confidence['review-header'], 'Review required');
        assert.strictEqual(response.reasons.length, 1);
        assert.strictEqual(response.reasons[0].summary, 'No changes proposed');
      },
    },
    {
      name: 'mapOutputToResponse maps needs_human_review correctly',
      fixture: 'needs-human-review.json',
      fnBody: 'function test() {\n  try {\n    doSomething();\n  } catch (e) {\n    handleError(e);\n  }\n}',
      assertions: (response: any, output: AgentOutput) => {
        assert.strictEqual(response['trace-id'], output.task_id);
        assert.strictEqual(response.confidence.level, 2);
        assert.strictEqual(response.confidence.title, 'Needs review');
        assert.strictEqual(response.confidence['review-header'], 'Review required');
        assert.strictEqual(response.reasons.length, 1);
      },
    },
  ];

  for (const tc of testCases) {
    test(tc.name, () => {
      const output = loadFixture(tc.fixture);
      const fnToRefactor = createMockFnToRefactor(tc.fnBody);
      const document = createMockDocument('/test/test.ts', tc.fnBody);

      const response = AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);

      tc.assertions(response, output);
    });
  }

  const confidenceLevelCases: Array<{ confidence: ConfidenceLevel; expectedLevel: number }> = [
    { confidence: 'high', expectedLevel: 3 },
    { confidence: 'medium', expectedLevel: 2 },
    { confidence: 'low', expectedLevel: 1 },
  ];

  for (const tc of confidenceLevelCases) {
    test(`mapOutputToResponse maps confidence level ${tc.confidence} to ${tc.expectedLevel}`, () => {
      const fnBody = 'function test() { oldCode; }';
      const output: AgentOutput = {
        '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
        schema_version: '1.0',
        task_id: 'test-123',
        fix_result: 'fix_proposed',
        confidence: tc.confidence,
        summary: 'Test summary',
        reasoning: 'Test reasoning',
        changes: [
          {
            file: 'test.ts',
            change_type: 'partial',
            description: 'Test change',
            replacements: [{ search: 'oldCode', replace: 'newCode' }],
          },
        ],
        generated_at: '2026-08-31T12:00:00Z',
      };

      const fnToRefactor = createMockFnToRefactor(fnBody);
      const document = createMockDocument('/test/test.ts', fnBody);

      const response = AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);

      assert.strictEqual(response.confidence.level, tc.expectedLevel);
    });
  }

  test('mapOutputToResponse applies replacements to code', () => {
    const output: AgentOutput = {
      '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
      schema_version: '1.0',
      task_id: 'test-replace',
      fix_result: 'fix_proposed',
      confidence: 'high',
      summary: 'Applied change',
      reasoning: 'Test',
      changes: [
        {
          file: 'test.ts',
          change_type: 'partial',
          description: 'Replace old with new',
          replacements: [{ search: 'oldCode', replace: 'newCode' }],
        },
      ],
      generated_at: '2026-08-31T12:00:00Z',
    };

    const fnBody = 'function test() { oldCode; }';
    const fnToRefactor = createMockFnToRefactor(fnBody);
    const document = createMockDocument('/test/test.ts', fnBody);

    const response = AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);

    assert.strictEqual(response.code, 'function test() { newCode; }');
  });

  test('mapOutputToResponse ignores changes for different files', () => {
    const output: AgentOutput = {
      '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
      schema_version: '1.0',
      task_id: 'test-different-file',
      fix_result: 'fix_proposed',
      confidence: 'high',
      summary: 'Applied change',
      reasoning: 'Test',
      changes: [
        {
          file: 'other.ts',
          change_type: 'partial',
          description: 'Replace in other file',
          replacements: [{ search: 'oldCode', replace: 'newCode' }],
        },
      ],
      generated_at: '2026-08-31T12:00:00Z',
    };

    const fnBody = 'function test() { oldCode; }';
    const fnToRefactor = createMockFnToRefactor(fnBody);
    const document = createMockDocument('/test/test.ts', fnBody);

    const response = AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);

    assert.strictEqual(response.code, fnBody);
  });

  test('mapOutputToResponse applies LF-based replacements to a CRLF function body', () => {
    const fnBody = 'void F(int a)\r\n{\r\n    if (a > 0)\r\n    {\r\n        Run(a);\r\n    }\r\n}';
    const output: AgentOutput = {
      '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
      schema_version: '1.0',
      task_id: 'test-crlf',
      fix_result: 'fix_proposed',
      confidence: 'high',
      summary: 'Applied change',
      reasoning: 'Test',
      changes: [
        {
          file: 'test.cs',
          change_type: 'partial',
          description: 'Guard clause',
          replacements: [
            {
              search: '    if (a > 0)\n    {\n        Run(a);\n    }\n',
              replace: '    if (a <= 0) return;\n    Run(a);\n',
            },
          ],
        },
      ],
      generated_at: '2026-08-31T12:00:00Z',
    };

    const fnToRefactor = createMockFnToRefactor(fnBody);
    const document = createMockDocument('/test/test.cs', fnBody);

    const response = AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);

    assert.strictEqual(response.code, 'void F(int a)\r\n{\r\n    if (a <= 0) return;\r\n    Run(a);\r\n}');
    assert.strictEqual(response.confidence.title, 'Applied change');
  });

  const trailingNewlineCases = [
    { name: 'LF', eol: '\n' },
    { name: 'CRLF', eol: '\r\n' },
  ];

  for (const { name, eol } of trailingNewlineCases) {
    test(`mapOutputToResponse applies a whole-method replacement whose search ends with a trailing newline (${name})`, () => {
      const fnBody = ['    void F(int a)', '    {', '        Run(a);', '    }'].join(eol);
      const output: AgentOutput = {
        '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
        schema_version: '1.0',
        task_id: 'test-trailing-newline',
        fix_result: 'fix_proposed',
        confidence: 'high',
        summary: 'Applied change',
        reasoning: 'Test',
        changes: [
          {
            file: 'test.cs',
            change_type: 'partial',
            description: 'Extract helper',
            replacements: [
              {
                search: '    void F(int a)\n    {\n        Run(a);\n    }\n',
                replace: '    void F(int a)\n    {\n        Helper(a);\n    }\n\n    void Helper(int a)\n    {\n        Run(a);\n    }\n',
              },
            ],
          },
        ],
        generated_at: '2026-08-31T12:00:00Z',
      };

      const fnToRefactor = createMockFnToRefactor(fnBody);
      const document = createMockDocument('/test/test.cs', fnBody);

      const response = AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);

      const expected = [
        '    void F(int a)',
        '    {',
        '        Helper(a);',
        '    }',
        '',
        '    void Helper(int a)',
        '    {',
        '        Run(a);',
        '    }',
      ].join(eol);
      assert.strictEqual(response.code, expected);
      assert.strictEqual(response.confidence.title, 'Applied change');
    });
  }

  test('runRefactoring rejects a document with unsaved changes', async () => {
    const fnBody = 'function test() { oldCode; }';
    const fnToRefactor = createMockFnToRefactor(fnBody);
    const document = { ...createMockDocument('/test/test.ts', fnBody), isDirty: true };

    await assert.rejects(
      () => AgentRefactoringService.runRefactoring(document, fnToRefactor),
      /Save .*test\.ts.* before refactoring/
    );
  });

  test('mapOutputToResponse sets metadata cached to false', () => {
    const output: AgentOutput = {
      '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
      schema_version: '1.0',
      task_id: 'test-metadata',
      fix_result: 'fix_proposed',
      confidence: 'high',
      summary: 'Test',
      reasoning: 'Test',
      changes: [],
      generated_at: '2026-08-31T12:00:00Z',
    };

    const fnToRefactor = createMockFnToRefactor('function test() {}');
    const document = createMockDocument('/test/test.ts', 'function test() {}');

    const response = AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);

    assert.strictEqual(response.metadata['cached?'], false);
  });

  test('mapOutputToResponse marks content-identical refactoring as unable_to_fix', () => {
    const fnBody = 'function test() { return 42; }';
    const output: AgentOutput = {
      '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
      schema_version: '1.0',
      task_id: 'test-identical',
      fix_result: 'fix_proposed',
      confidence: 'high',
      summary: 'Refactoring suggestion',
      reasoning: 'The refactoring improves code health.',
      changes: [],
      generated_at: '2026-08-31T12:00:00Z',
    };

    const fnToRefactor = createMockFnToRefactor(fnBody);
    const document = createMockDocument('/test/test.ts', fnBody);

    const response = AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);

    assert.strictEqual(response.confidence.level, 1);
    assert.strictEqual(response.confidence.title, 'Unable to refactor');
    assert.strictEqual(response.confidence['review-header'], 'Review required');
    assert.strictEqual(response.reasons.length, 1);
  });

  const goal: ScoreGoalTarget = { goalId: 2, metricId: 'average-code-health', operator: 'greater-than-or-equal', target: 8, baseline: 6.2, repoRoot: '/repo', path: 'src/a.ts' };
  const fixGoalOutput = (content: string | undefined): FixGoalOutput => ({ schema_version: '1.0', task_id: 't', fix_result: 'target_reached', confidence: 'high', explanation: 'x', whole_file_content: content, generated_at: '2026-11-11T00:00:00Z' });

  for (const c of [
    { name: 'scores the CRLF-normalised proposal', body: 'a\r\n', content: 'b\n', scores: [8.1], scored: ['b\r\n'], outcome: 'reached' },
    { name: 'does not score content that only differs in line endings', body: 'a\r\n', content: 'a\n', scores: [], scored: [], outcome: 'unable' },
    { name: 'does not score a missing proposal', body: 'a\n', content: undefined, scores: [], scored: [], outcome: 'unable' },
    { name: 'trusts the cs-ide score over the agent verdict', body: 'a\n', content: 'b\n', scores: [7], scored: ['b\n'], outcome: 'improved' },
  ]) {
    test(`resolveFixGoal ${c.name}`, async () => {
      const scored: string[] = [];
      const response = await AgentRefactoringService.resolveFixGoal(fixGoalOutput(c.content), createMockFnToRefactor(c.body), goal, async (content) => { scored.push(content); return c.scores[0]; });
      assert.deepStrictEqual({ scored, outcome: response['goal-outcome'] }, { scored: c.scored, outcome: c.outcome });
    });
  }

  test('resolveFixGoal fails rather than guess when cs-ide gives no score', async () => {
    await assert.rejects(AgentRefactoringService.resolveFixGoal(fixGoalOutput('b\n'), createMockFnToRefactor('a\n'), goal, async () => undefined), /Could not score the proposed change/);
  });

  const findingGoal = (finding: Partial<GoalFinding> = {}): FindingGoalTarget => ({
    goalId: 13,
    repoRoot: '/repo',
    path: 'src/a.ts',
    finding: { function: 'FindExtras', issues: ['Complex Method'], line: 4, ...finding },
  });
  const smell = (category: string) => ({ category, details: '', 'highlight-range': { 'start-line': 1, 'start-column': 1, 'end-line': 1, 'end-column': 1 } });
  const reviewWith = (fns: Record<string, string[]>, fileSmells: string[] = []): Review => ({
    'file-level-code-smells': fileSmells.map(smell),
    'function-level-code-smells': Object.entries(fns).map(([name, smells]) => ({
      function: name,
      range: { 'start-line': 1, 'start-column': 1, 'end-line': 1, 'end-column': 1 },
      'code-smells': smells.map(smell),
    })),
    'raw-score': '',
    score: 8,
  } as Review);
  const agentResponse = (code: string): RefactorResponse => ({
    code,
    confidence: { level: 3, title: 'Fixed', 'recommended-action': { description: 'd', details: 'reasoning' } },
    declarations: undefined,
    metadata: { 'cached?': false },
    reasons: [],
    'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': ['Complex Method'] },
    'trace-id': 't',
  } as RefactorResponse);

  for (const c of [
    { name: 'reaches the goal when the finding is gone from its function', goal: findingGoal(), review: reviewWith({ FindExtras: ['Bumpy Road Ahead'], Other: ['Complex Method'] }), outcome: 'reached' },
    { name: 'matches a reviewed function name that carries its line', goal: findingGoal(), review: reviewWith({ 'FindExtras:4': ['Complex Method'] }), outcome: 'unable' },
    { name: 'is unable when the finding remains in its function', goal: findingGoal(), review: reviewWith({ FindExtras: ['Complex Method'] }), outcome: 'unable' },
    { name: 'improves when the fixed issue is gone but another tracked issue remains', goal: findingGoal({ issues: ['Complex Method', 'Bumpy Road Ahead'] }), review: reviewWith({ FindExtras: ['Bumpy Road Ahead'] }), outcome: 'improved' },
    { name: 'looks at the whole file for a file-scope finding', goal: findingGoal({ function: undefined, issues: ['Code Duplication'] }), review: reviewWith({ Other: ['Code Duplication'] }), outcome: 'unable' },
    { name: 'reaches a file-scope goal when the file-level finding is gone', goal: findingGoal({ function: undefined, issues: ['Low Cohesion'] }), review: reviewWith({ Other: ['Complex Method'] }, ['Lines of Code in a Single File']), outcome: 'reached' },
  ]) {
    test(`resolveFindingFix ${c.name}`, async () => {
      const response = await AgentRefactoringService.resolveFindingFix(agentResponse('b\n'), createMockFnToRefactor('a\n'), c.goal, async () => c.review);
      assert.strictEqual(response['goal-outcome'], c.outcome);
    });
  }

  test('resolveFindingFix tells what it resolved where', async () => {
    const response = await AgentRefactoringService.resolveFindingFix(agentResponse('b\n'), createMockFnToRefactor('a\n'), findingGoal(), async () => reviewWith({}));
    assert.deepStrictEqual(
      { code: response.code, title: response.confidence.title, details: response.confidence['recommended-action'].details },
      { code: 'b\n', title: 'Goal reached', details: 'Resolved Complex Method in FindExtras' }
    );
  });

  test('resolveFindingFix does not review a proposal that changes nothing', async () => {
    const reviewed: string[] = [];
    const response = await AgentRefactoringService.resolveFindingFix(agentResponse('a\n'), createMockFnToRefactor('a\n'), findingGoal(), async (content) => {
      reviewed.push(content);
      return reviewWith({});
    });
    assert.deepStrictEqual({ reviewed, outcome: response['goal-outcome'] }, { reviewed: [], outcome: 'unable' });
  });

  test('resolveFindingFix fails rather than guess when cs-ide gives no review', async () => {
    await assert.rejects(AgentRefactoringService.resolveFindingFix(agentResponse('b\n'), createMockFnToRefactor('a\n'), findingGoal(), async () => undefined), /Could not review the proposed change/);
  });

  test('buildInput for a finding goal asks the agent to fix its first issue at its line', () => {
    const document = createMockDocument('/repo/src/a.ts', 'a\n');
    const fnToRefactor = { ...createMockFnToRefactor('a\n'), 'refactoring-targets': findingTargets(findingGoal()) };
    assert.deepStrictEqual(AgentRefactoringService.buildInput(document, fnToRefactor, 'refactor-1'), {
      '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
      task_id: 'refactor-1',
      file: '/repo/src/a.ts',
      line: 4,
      smell: 'Complex Method',
    });
  });

  test('runFixGoal rejects a document with unsaved changes', async () => {
    const document = { ...createMockDocument('/repo/src/a.ts', 'a\n'), isDirty: true };
    await assert.rejects(() => AgentRefactoringService.runFixGoal(document, createMockFnToRefactor('a\n'), goal, async () => 8), /Save .*a\.ts.* before refactoring/);
  });

  test('abort during agent invocation rejects with AbortError not Error', () => {
    const error = new AbortError('Agent invocation aborted');
    assert.ok(error instanceof AbortError);
    assert.ok(error instanceof Error);
    assert.strictEqual(error.message, 'Agent invocation aborted');
  });
});
