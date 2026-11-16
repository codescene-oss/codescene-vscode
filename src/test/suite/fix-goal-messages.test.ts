import * as assert from 'assert';
import * as path from 'path';
import type { ObjectivesSnapshot, LocalFileResult, ObjectiveRecommendation } from '../../centralized-webview-framework/types/objectives';
import { resolveFixGoalTarget, handleFixGoal, type FixGoalDeps } from '../../objectives/fix-goal-messages';
import { fixture } from '../contract/contract';

const full = () => {
  const s = fixture('objectives-snapshot', 'full', 'entity') as ObjectivesSnapshot;
  s.objectives[0].subject = { type: 'files', files: s.objectives[0].subject.files };
  return s;
};
const recommendation = (over: Partial<ObjectiveRecommendation> = {}, file: Partial<LocalFileResult> = {}) => {
  const s = fixture('objectives-snapshot', 'full', 'entity') as ObjectivesSnapshot;
  const goal = s.objectives[0];
  goal.subject.recommendation = { ...goal.subject.recommendation!, ...over };
  goal.local.files = [{ path: 'src/orders.js', result: 'violated', reason: 'finding-present', line: 12, ...file }];
  return s;
};
const evidence = (issues: string[]) => ({ 'code-health-issues': issues });
const withFile = (over: Partial<LocalFileResult>) => {
  const s = full();
  s.objectives[0].local.files = [{ ...s.objectives[0].local.files![0], ...over }];
  return s;
};

suite('Fix goal messages Test Suite', () => {
  let opened: string[];
  let commands: Array<[string, ...unknown[]]>;
  let logs: string[];
  let document: any;
  let deps: FixGoalDeps;

  setup(() => {
    opened = [];
    commands = [];
    logs = [];
    document = {};
    deps = {
      snapshot: () => full(),
      enabled: () => true,
      openDocument: (fsPath: string) => {
        opened.push(fsPath);
        return Promise.resolve(document);
      },
      executeCommand: (command: string, ...args: unknown[]) => {
        commands.push([command, ...args]);
        return Promise.resolve(undefined);
      },
      log: (message: string) => {
        logs.push(message);
      },
    };
  });

  test('resolveFixGoalTarget takes target, baseline and operator from the file of the goal', () => {
    assert.deepStrictEqual(resolveFixGoalTarget(full(), 2, 'src/orders.js'), {
      goalId: 2,
      metricId: full().objectives[0]['metric-id'],
      operator: 'greater-than-or-equal',
      target: 9,
      baseline: 6,
      repoRoot: '/work/fake-repo',
      path: 'src/orders.js',
    });
  });

  for (const c of [
    { name: 'no snapshot', snapshot: undefined, goalId: 2, path: 'src/orders.js', reason: 'goal-not-found' },
    { name: 'goal gone', snapshot: full(), goalId: 99, path: 'src/orders.js', reason: 'goal-not-found' },
    {
      name: 'a policy with that id',
      snapshot: (() => {
        const s = full();
        s.objectives[0].kind = 'policy';
        return s;
      })(),
      goalId: 2,
      path: 'src/orders.js',
      reason: 'goal-not-found',
    },
    { name: 'file not in the goal', snapshot: full(), goalId: 2, path: 'src/other.js', reason: 'file-not-in-goal' },
    {
      name: 'file already satisfied',
      snapshot: withFile({ result: 'satisfied' }),
      goalId: 2,
      path: 'src/orders.js',
      reason: 'not-violated',
    },
    {
      name: 'file indeterminate',
      snapshot: withFile({ result: 'indeterminate' }),
      goalId: 2,
      path: 'src/orders.js',
      reason: 'not-violated',
    },
    {
      name: 'no current value',
      snapshot: withFile({ value: undefined }),
      goalId: 2,
      path: 'src/orders.js',
      reason: 'no-scores',
    },
    {
      name: 'no comparison value',
      snapshot: withFile({ 'comparison-value': undefined }),
      goalId: 2,
      path: 'src/orders.js',
      reason: 'no-scores',
    },
  ]) {
    test(`resolveFixGoalTarget rejects: ${c.name}`, () =>
      assert.strictEqual(resolveFixGoalTarget(c.snapshot, c.goalId, c.path), c.reason));
  }

  test('resolveFixGoalTarget takes the finding of a recommendation Goal: its function, issues and line', () => {
    assert.deepStrictEqual(resolveFixGoalTarget(recommendation({ target: 'orders:18' }), 2, 'src/orders.js'), {
      goalId: 2,
      repoRoot: '/work/fake-repo',
      path: 'src/orders.js',
      finding: { function: 'orders', issues: ['Complex Method'], line: 12 },
    });
  });

  test('resolveFixGoalTarget leaves out the function of a file-scope recommendation Goal', () => {
    const target = resolveFixGoalTarget(recommendation({ scope: 'file', target: 'src/orders.js' }, { line: 1 }), 2, 'src/orders.js');
    assert.deepStrictEqual(target, {
      goalId: 2,
      repoRoot: '/work/fake-repo',
      path: 'src/orders.js',
      finding: { issues: ['Complex Method'], line: 1 },
    });
  });

  for (const c of [
    { name: 'resolved finding', snapshot: recommendation({}, { result: 'satisfied', line: undefined }), reason: 'not-violated' },
    { name: 'no finding line', snapshot: recommendation({}, { line: undefined }), reason: 'no-finding' },
    { name: 'no recommendation', snapshot: recommendation({}, {}), reason: 'no-finding', strip: true },
    { name: 'no issues', snapshot: recommendation({ evidence: evidence([]) }), reason: 'no-finding' },
  ]) {
    test(`resolveFixGoalTarget rejects a recommendation Goal: ${c.name}`, () => {
      if (c.strip) delete c.snapshot.objectives[0].subject.recommendation;
      assert.strictEqual(resolveFixGoalTarget(c.snapshot, 2, 'src/orders.js'), c.reason);
    });
  }

  test('handleFixGoal opens the file under the repository root and runs the goal', async () => {
    await handleFixGoal(2, 'src/orders.js', deps);
    assert.deepStrictEqual(
      { opened, commands },
      {
        opened: [path.join('/work/fake-repo', 'src/orders.js')],
        commands: [
          [
            'codescene.requestAndPresentRefactoring',
            document,
            'objectives',
            undefined,
            false,
            undefined,
            resolveFixGoalTarget(full(), 2, 'src/orders.js'),
          ],
        ],
      }
    );
  });

  for (const c of [
    { name: 'agent disabled', over: { enabled: () => false }, expectCommands: 0 },
    { name: 'goal gone', over: { snapshot: () => undefined }, expectCommands: 0 },
    { name: 'file cannot be opened', over: { openDocument: () => Promise.reject(new Error('ENOENT')) }, expectCommands: 0 },
    {
      name: 'the refactoring command fails',
      over: {
        executeCommand: (command: string, ...args: unknown[]) => {
          commands.push([command, ...args]);
          return Promise.reject(new Error('boom'));
        },
      },
      expectCommands: 1,
    },
  ]) {
    test(`handleFixGoal does nothing but log when ${c.name}`, async () => {
      await handleFixGoal(2, 'src/orders.js', { ...deps, ...c.over });
      assert.deepStrictEqual({ commands: commands.length, logged: logs.length }, { commands: c.expectCommands, logged: 1 });
    });
  }
});
