import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AgentRefactoringService } from '../../refactoring/agent-service';
import { AgentOutput, ConfidenceLevel } from '../../refactoring/agent-types';
import { FnToRefactor } from '../../devtools-api/refactor-models';
import { aceSuite } from '../ace-test-suite';
import { Range, Position } from '../mocks/vscode';

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
      assertions: (response: any, output: AgentOutput) => {
        assert.strictEqual(response['trace-id'], output.task_id);
        assert.strictEqual(response.confidence.level, 1);
        assert.strictEqual(response.confidence.title, 'Unable to refactor');
        assert.strictEqual(response.confidence['review-header'], 'Review required');
        assert.strictEqual(response.reasons.length, 1);
        assert.strictEqual(response.reasons[0].summary, output.summary);
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
      const output: AgentOutput = {
        '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
        schema_version: '1.0',
        task_id: 'test-123',
        fix_result: 'fix_proposed',
        confidence: tc.confidence,
        summary: 'Test summary',
        reasoning: 'Test reasoning',
        changes: [],
        generated_at: '2026-08-31T12:00:00Z',
      };

      const fnToRefactor = createMockFnToRefactor('function test() {}');
      const document = createMockDocument('/test/test.ts', 'function test() {}');

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
});
