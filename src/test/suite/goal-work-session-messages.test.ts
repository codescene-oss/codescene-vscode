import * as assert from 'assert';
import type { ObjectivesSnapshot } from '../../centralized-webview-framework/types/objectives';
import { GOAL_WORK_SESSIONS_CAPABILITY, OBJECTIVES_CAPABILITY, ObjectivesService } from '../../objectives/objectives-service';
import { handleGoalWorkSessionStart } from '../../objectives/goal-work-session-messages';
import { fixture } from '../contract/contract';
import { FakeObjectivesTransport } from '../fakes/fake-objectives-transport';
import { GoalWorkSessionRpc } from '../../objectives/goal-work-session-rpc';
import { flushPromises } from '../fakes/fake-auth-transport';

const REPO_A = '/work/repo-a';
const REPO_B = '/work/repo-b';

function snapshotFor(repoRoot: string, goalId: number): ObjectivesSnapshot {
  const snapshot = { ...fixture('objectives-snapshot', 'full', 'entity'), 'repo-root': repoRoot };
  // Add a goal with the specified ID
  snapshot.objectives = [
    {
      ...snapshot.objectives[0],
      kind: 'goal' as const,
      id: goalId,
    },
  ];
  return snapshot;
}

interface RecordedWarning {
  message: string;
  actions: string[];
  picked?: string;
}

interface RecordedInfo {
  message: string;
}

suite('Goal work session messages', () => {
  let transport: FakeObjectivesTransport;
  let service: ObjectivesService;
  let rpc: GoalWorkSessionRpc;
  let warnings: RecordedWarning[];
  let infos: RecordedInfo[];
  let executedCommands: string[];
  let logMessages: string[];
  let capable: boolean;
  let reauthorizable: boolean;

  async function setupDeps() {
    transport = new FakeObjectivesTransport(
      { sha: 'sha', version: 'version', capabilities: [OBJECTIVES_CAPABILITY, GOAL_WORK_SESSIONS_CAPABILITY] },
      (repoPath) => snapshotFor(repoPath, 1)
    );
    service = new ObjectivesService(transport);
    await service.start();
    rpc = new GoalWorkSessionRpc(transport);
    warnings = [];
    infos = [];
    executedCommands = [];
    logMessages = [];
    capable = true;
    reauthorizable = true;
  }

  function deps(goalId: number) {
    return {
      rpc,
      snapshot: () => service.findSnapshotWithGoal(goalId),
      capable: () => capable,
      canReauthorize: () => reauthorizable,
      notify: {
        warn: async (message: string, ...actions: string[]) => {
          const warning: RecordedWarning = { message, actions };
          warnings.push(warning);
          const picked = actions.length > 0 ? actions[0] : undefined;
          warning.picked = picked;
          return picked;
        },
        info: async (message: string) => {
          infos.push({ message });
        },
      },
      executeCommand: async (id: string) => {
        executedCommands.push(id);
      },
      log: (message: string) => {
        logMessages.push(message);
      },
    };
  }

  setup(async () => {
    await setupDeps();
  });

  teardown(() => {
    service?.dispose();
  });

  test('start-sends-rpc-with-snapshot-repo-root-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 123));
    transport.setWorkSessionStartResult({ result: 'started' });

    await handleGoalWorkSessionStart(123, deps(123));

    assert.strictEqual(transport.requests.length, 2); // objectives request + goalWorkSessionStart
    const startRequest = transport.requests.find((r) => r.method === 'cs-ide/goalWorkSessionStart');
    assert.deepStrictEqual(startRequest, {
      method: 'cs-ide/goalWorkSessionStart',
      params: { 'repo-path': REPO_A, 'goal-id': 123 },
    });
  });

  test('start-uses-snapshot-repo-root-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_B });
    await flushPromises();
    transport.notify(snapshotFor(REPO_B, 456));
    transport.setWorkSessionStartResult({ result: 'started' });

    await handleGoalWorkSessionStart(456, deps(456));

    const startRequest = transport.requests.find((r) => r.method === 'cs-ide/goalWorkSessionStart');
    assert.ok(startRequest, 'Should have sent goalWorkSessionStart');
    const params = startRequest.params as Record<string, unknown>;
    assert.strictEqual(params['repo-path'], REPO_B, 'Should use repo-root from snapshot containing the goal');
  });

  test('started-shows-no-notification-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'started' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(infos.length, 0);
  });

  test('unavailable-shows-no-notification-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'unavailable' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(infos.length, 0);
  });

  test('goal-inactive-shows-exact-copy-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'goal-inactive' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].message, "This Goal is no longer active, so a work session can't be started.");
    assert.strictEqual(warnings[0].actions.length, 0);
  });

  test('parent-inactive-shows-exact-copy-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'parent-inactive' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].message, "This Goal's Policy is inactive, so a work session can't be started.");
    assert.strictEqual(warnings[0].actions.length, 0);
  });

  test('network-shows-exact-copy-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'network' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].message, "Couldn't reach CodeScene to start the work session. Try again.");
    assert.strictEqual(warnings[0].actions.length, 0);
  });

  test('scope-missing-shows-exact-copy-and-action-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'scope-missing' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].message, 'Re-authorize CodeScene to use work sessions.');
    assert.deepStrictEqual(warnings[0].actions, ['Re-authorize']);
  });

  test('scope-missing-action-runs-reauthorize-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'scope-missing' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(executedCommands.length, 1);
    assert.strictEqual(executedCommands[0], 'codescene.reauthorize');
  });

  test('scope-missing-without-reauthorize-shows-token-copy-test', async () => {
    reauthorizable = false;
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'scope-missing' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.deepStrictEqual(
      { warnings, executedCommands },
      {
        warnings: [{ message: "Your access token doesn't allow work sessions.", actions: [], picked: undefined }],
        executedCommands: [],
      }
    );
  });

  test('signed-out-shows-exact-copy-and-action-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'signed-out' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].message, 'Sign in to CodeScene to use work sessions.');
    assert.deepStrictEqual(warnings[0].actions, ['Sign in']);
  });

  test('signed-out-action-runs-sign-in-command-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.setWorkSessionStartResult({ result: 'signed-out' });

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(executedCommands.length, 1);
    assert.strictEqual(executedCommands[0], 'codescene.browserSignIn');
  });

  test('start-rejected-by-restart-shows-network-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    transport.failRequests(new Error('Connection refused'));

    await handleGoalWorkSessionStart(1, deps(1));

    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].message, "Couldn't reach CodeScene to start the work session. Try again.");
    assert.strictEqual(logMessages.length, 1);
    assert.ok(logMessages[0].includes('Start failed'), 'Should log the error');
  });

  test('start-without-capability-is-ignored-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 1));
    capable = false;
    transport.setWorkSessionStartResult({ result: 'started' });

    await handleGoalWorkSessionStart(1, deps(1));

    const startRequest = transport.requests.find((r) => r.method === 'cs-ide/goalWorkSessionStart');
    assert.strictEqual(startRequest, undefined, 'Should not send goalWorkSessionStart when capability is missing');
    assert.strictEqual(logMessages.length, 1);
    assert.ok(logMessages[0].includes('work session'), 'Should log about work session');
  });

  test('goal-not-in-any-snapshot-is-ignored-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 999)); // Different goal ID
    transport.setWorkSessionStartResult({ result: 'started' });

    await handleGoalWorkSessionStart(1, deps(1));

    const startRequest = transport.requests.find((r) => r.method === 'cs-ide/goalWorkSessionStart');
    assert.strictEqual(startRequest, undefined, 'Should not send goalWorkSessionStart when goal is not found');
    assert.strictEqual(logMessages.length, 1);
    assert.ok(logMessages[0].includes('not found'), 'Should log that goal was not found');
  });

  test('multi-repo-finds-correct-snapshot-test', async () => {
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A, 100));
    transport.notify(snapshotFor(REPO_B, 200));
    transport.setWorkSessionStartResult({ result: 'started' });

    await handleGoalWorkSessionStart(200, deps(200));

    const startRequest = transport.requests.find((r) => r.method === 'cs-ide/goalWorkSessionStart');
    assert.ok(startRequest, 'Should have sent goalWorkSessionStart');
    const params = startRequest.params as Record<string, unknown>;
    assert.strictEqual(params['repo-path'], REPO_B, 'Should use repo-root from correct snapshot');
    assert.strictEqual(params['goal-id'], 200);
  });
});
