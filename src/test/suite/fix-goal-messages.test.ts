import * as assert from 'assert';
import * as path from 'path';
import type { ObjectivesSnapshot, LocalFileResult } from '../../centralized-webview-framework/types/objectives';
import { resolveFixGoalTarget, handleFixGoal, type FixGoalDeps } from '../../objectives/fix-goal-messages';
import { fixture } from '../contract/contract';

const full = () => fixture('objectives-snapshot', 'full', 'entity') as ObjectivesSnapshot;
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
