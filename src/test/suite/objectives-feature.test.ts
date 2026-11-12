import * as assert from 'assert';
import * as vscode from 'vscode';
import { REAUTHORIZE_COMMAND } from '../../auth/auth-commands';
import type { AuthSnapshot } from '../../auth/auth-payload';
import type { ObjectivesSnapshot } from '../../centralized-webview-framework/types/objectives';
import { handleCWFMessage } from '../../code-health-monitor/home/cwf-message-handlers';
import type { GoalWorkSessionStartResult } from '../../objectives/goal-work-session-rpc';
import { setCwfObjectives } from '../../objectives/cwf-objectives';
import { activateObjectives, type ObjectivesFeature } from '../../objectives/objectives-feature';
import { GOAL_WORK_SESSIONS_CAPABILITY, OBJECTIVES_CAPABILITY } from '../../objectives/objectives-service';
import { fixture } from '../contract/contract';
import { flushPromises } from '../fakes/fake-auth-transport';
import { FakeObjectivesTransport } from '../fakes/fake-objectives-transport';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';
import { DevtoolsAPI } from '../../devtools-api';
import { aceTest } from '../ace-test-suite';

const REPO = '/work/repo-a';
const GOAL_ID = 42;
const START_METHOD = 'cs-ide/goalWorkSessionStart';

function snapshotWithGoal(repoRoot: string): ObjectivesSnapshot {
  const snapshot = { ...fixture('objectives-snapshot', 'full', 'entity'), 'repo-root': repoRoot };
  snapshot.objectives = [{ ...snapshot.objectives[0], kind: 'goal' as const, id: GOAL_ID }];
  return snapshot;
}

function signedIn(reauthorizeNeeded: boolean): Pick<AuthSnapshot, 'active' | 'status' | 'syncing' | 'repo'> {
  return {
    active: true,
    status: { ...authStatusFixture('signed-in-oauth'), 'reauthorize-needed': reauthorizeNeeded },
    syncing: false,
    repo: { path: REPO, name: 'repo-a' },
  };
}

suite('Objectives feature work sessions', () => {
  let transport: FakeObjectivesTransport;
  let feature: ObjectivesFeature;
  let warnings: Array<{ message: string; actions: string[] }>;
  let executed: string[];
  let pick: string | undefined;
  let originalWarn: typeof vscode.window.showWarningMessage;
  let originalExecute: typeof vscode.commands.executeCommand;

  setup(() => {
    warnings = [];
    executed = [];
    pick = undefined;
    originalWarn = vscode.window.showWarningMessage;
    originalExecute = vscode.commands.executeCommand;
    (vscode.window as any).showWarningMessage = (message: string, ...actions: string[]) => {
      warnings.push({ message, actions });
      return Promise.resolve(pick);
    };
    (vscode.commands as any).executeCommand = (command: string) => {
      executed.push(command);
      return Promise.resolve(undefined);
    };
  });

  teardown(() => {
    feature?.disposables.forEach((disposable) => disposable.dispose());
    setCwfObjectives(undefined);
    (vscode.window as any).showWarningMessage = originalWarn;
    (vscode.commands as any).executeCommand = originalExecute;
  });

  async function activate(result: GoalWorkSessionStartResult, capabilities: string[]): Promise<void> {
    transport = new FakeObjectivesTransport({ sha: 'sha', version: 'version', capabilities }, snapshotWithGoal);
    transport.setWorkSessionStartResult(result);
    feature = activateObjectives(transport);
    await flushPromises();
  }

  const startRequests = () => transport.requests.filter((request) => request.method === START_METHOD);

  test('starts a work session for the goal in the loaded repository', async () => {
    await activate({ result: 'started' }, [OBJECTIVES_CAPABILITY, GOAL_WORK_SESSIONS_CAPABILITY]);
    feature.update(signedIn(false));
    await flushPromises();
    await feature.startWorkSession(GOAL_ID);
    assert.deepStrictEqual(
      { starts: startRequests(), warnings },
      { starts: [{ method: START_METHOD, params: { 'repo-path': REPO, 'goal-id': GOAL_ID } }], warnings: [] }
    );
  });

  test('offers to re-authorize a missing scope when the auth status allows it, and runs the command', async () => {
    await activate({ result: 'scope-missing' }, [OBJECTIVES_CAPABILITY, GOAL_WORK_SESSIONS_CAPABILITY]);
    pick = 'Re-authorize';
    feature.update(signedIn(true));
    await flushPromises();
    await feature.startWorkSession(GOAL_ID);
    await flushPromises();
    assert.deepStrictEqual(
      { warnings, executed },
      {
        warnings: [{ message: 'Re-authorize CodeScene to use work sessions.', actions: ['Re-authorize'] }],
        executed: [REAUTHORIZE_COMMAND],
      }
    );
  });

  test('explains a missing scope without offering re-authorization when the auth status does not allow it', async () => {
    await activate({ result: 'scope-missing' }, [OBJECTIVES_CAPABILITY, GOAL_WORK_SESSIONS_CAPABILITY]);
    feature.update(signedIn(false));
    await flushPromises();
    await feature.startWorkSession(GOAL_ID);
    assert.deepStrictEqual(warnings, [{ message: "Your access token doesn't allow work sessions.", actions: [] }]);
  });

  test('does not start a work session when the server lacks the work-session capability', async () => {
    await activate({ result: 'started' }, [OBJECTIVES_CAPABILITY]);
    feature.update(signedIn(false));
    await flushPromises();
    await feature.startWorkSession(GOAL_ID);
    assert.deepStrictEqual({ starts: startRequests(), warnings }, { starts: [], warnings: [] });
  });

  test('routes a goal-work-session-start webview message to the registered feature', async () => {
    await activate({ result: 'started' }, [OBJECTIVES_CAPABILITY, GOAL_WORK_SESSIONS_CAPABILITY]);
    feature.update(signedIn(false));
    await flushPromises();
    await handleCWFMessage({} as any, { messageType: 'goal-work-session-start', payload: { goalId: GOAL_ID } });
    assert.deepStrictEqual(startRequests(), [
      { method: START_METHOD, params: { 'repo-path': REPO, 'goal-id': GOAL_ID } },
    ]);
  });

  test('ignores a goal-work-session-start webview message once the feature is disposed', async () => {
    await activate({ result: 'started' }, [OBJECTIVES_CAPABILITY, GOAL_WORK_SESSIONS_CAPABILITY]);
    feature.update(signedIn(false));
    await flushPromises();
    feature.disposables.forEach((disposable) => disposable.dispose());
    const originalConsoleWarn = console.warn;
    const consoleWarnings: string[] = [];
    console.warn = (message: string) => consoleWarnings.push(message);
    try {
      await handleCWFMessage({} as any, { messageType: 'goal-work-session-start', payload: { goalId: GOAL_ID } });
    } finally {
      console.warn = originalConsoleWarn;
    }
    assert.deepStrictEqual(
      { starts: startRequests(), consoleWarnings },
      {
        starts: [],
        consoleWarnings: ['[objectives] Message goal-work-session-start received but objectives actions not registered'],
      }
    );
  });
});

suite('Objectives feature fix goal', () => {
  let transport: FakeObjectivesTransport;
  let feature: ObjectivesFeature;
  let executed: Array<{ command: string; args: unknown[] }>;
  let originalExecute: typeof vscode.commands.executeCommand;
  let originalOpenTextDocument: typeof vscode.workspace.openTextDocument;

  const path = 'src/orders.js';

  function snapshotWithGoalAndFile(repoRoot: string): ObjectivesSnapshot {
    const snapshot = { ...fixture('objectives-snapshot', 'full', 'entity'), 'repo-root': repoRoot };
    snapshot.objectives = [
      {
        ...snapshot.objectives[0],
        kind: 'goal' as const,
        id: GOAL_ID,
        local: {
          result: 'violated' as const,
          reason: 'threshold-not-met',
          files: [
            {
              path,
              result: 'violated' as const,
              reason: 'threshold-not-met',
              value: 6,
              'comparison-value': 9,
            },
          ],
        },
      },
    ];
    return snapshot;
  }

  setup(() => {
    executed = [];
    originalExecute = vscode.commands.executeCommand;
    originalOpenTextDocument = vscode.workspace.openTextDocument;
    (vscode.commands as any).executeCommand = (command: string, ...args: unknown[]) => {
      executed.push({ command, args });
      return Promise.resolve(undefined);
    };
    (vscode.workspace as any).openTextDocument = () => Promise.resolve({});
  });

  teardown(() => {
    feature?.disposables.forEach((disposable) => disposable.dispose());
    setCwfObjectives(undefined);
    (vscode.commands as any).executeCommand = originalExecute;
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    DevtoolsAPI.disableAce();
  });

  async function activate(): Promise<void> {
    transport = new FakeObjectivesTransport(
      { sha: 'sha', version: 'version', capabilities: [OBJECTIVES_CAPABILITY] },
      snapshotWithGoalAndFile
    );
    feature = activateObjectives(transport);
    feature.update(signedIn(false));
    await flushPromises();
  }

  aceTest('routes a fix-goal webview message to the requestAndPresentRefactoring command', async () => {
    DevtoolsAPI.enableAce();
    await activate();
    await handleCWFMessage({} as any, { messageType: 'fix-goal', payload: { goalId: GOAL_ID, path } });
    assert.strictEqual(executed.length, 1);
    assert.strictEqual(executed[0].command, 'codescene.requestAndPresentRefactoring');
    assert.strictEqual(executed[0].args[1], 'objectives');
    const target = executed[0].args[5] as any;
    assert.strictEqual(target.repoRoot, REPO);
  });
});
