import * as assert from 'assert';
import { DevtoolsAPI } from '../../devtools-api';
import { RefactoringRequest } from '../../refactoring/request';
import { fnToRefactorForWholeFile } from '../../refactoring/fn-to-refactor';
import { TestTextDocument } from '../mocks/test-text-document';
import { AgentRefactoringService } from '../../refactoring/agent-service';
import { FixGoalTarget } from '../../refactoring/agent-types';
import { aceSuite } from '../ace-test-suite';
import * as csExtensionState from '../../cs-extension-state';
import * as configModule from '../../configuration';

const document = new TestTextDocument('/repo/src/file.ts', 'const a = 1;\n', 'typescript');
const goal: FixGoalTarget = {
  goalId: 2,
  metricId: 'code-health',
  operator: 'greater-than-or-equal',
  target: 8.0,
  baseline: 6.2,
  repoRoot: '/repo',
  path: 'src/file.ts',
};

aceSuite('Fix goal request Test Suite', () => {
  const calls = { fixGoal: 0, refactor: 0 };
  let originalRunFixGoal: any;
  let originalRunRefactoring: any;
  let originalGetAuthToken: any;

  setup(() => {
    DevtoolsAPI.enableAce();
    calls.fixGoal = 0;
    calls.refactor = 0;

    Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', {
      get: () => ({
        auth: { active: false, status: null },
        features: {
          analysis: { state: 'enabled' },
          ace: { state: 'enabled' }
        }
      }),
      configurable: true
    });

    originalGetAuthToken = configModule.getAuthToken;
    (configModule as any).getAuthToken = () => 'test-token';

    originalRunFixGoal = AgentRefactoringService.runFixGoal;
    originalRunRefactoring = AgentRefactoringService.runRefactoring;

    (AgentRefactoringService as any).runFixGoal = async () => {
      calls.fixGoal++;
      return { code: '', confidence: { level: 1, title: '', 'recommended-action': { description: '', details: '' } }, reasons: [], 'refactoring-properties': { 'removed-code-smells': [], 'added-code-smells': [] }, metadata: {}, 'trace-id': '', 'goal-outcome': 'improved' };
    };

    (AgentRefactoringService as any).runRefactoring = async () => {
      calls.refactor++;
      return { code: '', confidence: { level: 1, title: '', 'recommended-action': { description: '', details: '' } }, reasons: [], 'refactoring-properties': { 'removed-code-smells': [], 'added-code-smells': [] }, metadata: {}, 'trace-id': '' };
    };
  });

  teardown(() => {
    if (originalRunFixGoal) {
      (AgentRefactoringService as any).runFixGoal = originalRunFixGoal;
    }
    if (originalRunRefactoring) {
      (AgentRefactoringService as any).runRefactoring = originalRunRefactoring;
    }
    if (originalGetAuthToken) {
      (configModule as any).getAuthToken = originalGetAuthToken;
    }
  });

  test('a request with a goal runs the fix-goal skill and records the outcome', async () => {
    const request = new RefactoringRequest(fnToRefactorForWholeFile(document), document, false, goal);
    await request.promise;
    assert.deepStrictEqual({ fixGoal: calls.fixGoal, refactor: calls.refactor, data: request.eventData }, { fixGoal: 1, refactor: 0, data: { traceId: request.traceId, goalId: 2, outcome: 'improved' } });
  });

  test('a request without a goal keeps running render-code-fix', async () => {
    const request = new RefactoringRequest(fnToRefactorForWholeFile(document), document, false);
    await request.promise;
    assert.deepStrictEqual({ fixGoal: calls.fixGoal, refactor: calls.refactor, hasGoalId: 'goalId' in request.eventData, hasOutcome: 'outcome' in request.eventData }, { fixGoal: 0, refactor: 1, hasGoalId: false, hasOutcome: false });
  });
});
