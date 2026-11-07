import * as assert from 'assert';
import type { ObjectivesSnapshot } from '../../centralized-webview-framework/types/objectives';
import { activateObjectives } from '../../objectives/objectives-feature';
import { OBJECTIVES_CAPABILITY, ObjectivesService } from '../../objectives/objectives-service';
import { fixture } from '../contract/contract';
import { flushPromises } from '../fakes/fake-auth-transport';
import { FakeObjectivesTransport } from '../fakes/fake-objectives-transport';
import { authStatusFixture, type AuthStatusFixture } from '../fixtures/auth/auth-fixtures';

const REPO_A = '/work/repo-a';
const REPO_B = '/work/repo-b';

function snapshotFor(repoRoot: string, state: ObjectivesSnapshot['state'] = 'ok'): ObjectivesSnapshot {
  return { ...fixture('objectives-snapshot', 'full', 'entity'), 'repo-root': repoRoot, state };
}

suite('ObjectivesService', () => {
  let transport: FakeObjectivesTransport;
  let service: ObjectivesService;
  let changes: number;

  async function startService(capabilities: string[] = [OBJECTIVES_CAPABILITY]): Promise<void> {
    transport = new FakeObjectivesTransport({ sha: 'sha', version: 'version', capabilities }, (repoPath) => snapshotFor(repoPath));
    service = new ObjectivesService(transport);
    changes = 0;
    service.onDidChange(() => changes++);
    await service.start();
  }

  function requestedRepos(): string[] {
    return transport.requests.map((request) => (request.params as Record<string, string>)['repo-path']);
  }

  teardown(() => service.dispose());

  const unavailableCases: Array<{ name: string; capabilities: string[]; active: boolean; repoPath: string | undefined }> = [
    { name: 'the server lacks objectives-v1', capabilities: [], active: true, repoPath: REPO_A },
    { name: 'sign-in is not active', capabilities: [OBJECTIVES_CAPABILITY], active: false, repoPath: REPO_A },
    { name: 'there is no repository', capabilities: [OBJECTIVES_CAPABILITY], active: true, repoPath: undefined },
  ];

  for (const { name, capabilities, active, repoPath } of unavailableCases) {
    test(`publishes nothing and asks for nothing when ${name}`, async () => {
      await startService(capabilities);
      service.setContext({ active, settled: true, repoPath });
      await flushPromises();
      assert.deepStrictEqual(
        { requests: transport.requests, current: service.current, changes },
        { requests: [], current: undefined, changes: 0 }
      );
    });
  }

  test('requests the snapshot of the repository once it is active and publishes it', async () => {
    await startService();
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    assert.deepStrictEqual(
      { requests: transport.requests, current: service.current, changes },
      { requests: [{ method: 'cs-ide/objectives', params: { 'repo-path': REPO_A } }], current: snapshotFor(REPO_A), changes: 1 }
    );
  });

  test('requests again when the repository changes, not when it stays the same', async () => {
    await startService();
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    service.setContext({ active: true, settled: true, repoPath: REPO_B });
    await flushPromises();
    service.setContext({ active: true, settled: true, repoPath: REPO_B });
    await flushPromises();
    assert.deepStrictEqual({ requested: requestedRepos(), repo: service.current?.['repo-root'], changes }, { requested: [REPO_A, REPO_B], repo: REPO_B, changes: 3 });
  });

  test('publishes a pushed snapshot of the current repository and keeps one of another repository silent', async () => {
    await startService();
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_B));
    const afterOther = changes;
    transport.notify(snapshotFor(REPO_A, 'unavailable'));
    assert.deepStrictEqual({ afterOther, state: service.current?.state, changes }, { afterOther: 1, state: 'unavailable', changes: 2 });
  });

  test('does not publish an identical pushed snapshot twice', async () => {
    await startService();
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.notify(snapshotFor(REPO_A));
    assert.strictEqual(changes, 1);
  });

  test('asks again when the server restarts', async () => {
    await startService();
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.emitRestart();
    await flushPromises();
    assert.deepStrictEqual({ requested: requestedRepos(), current: service.current }, { requested: [REPO_A, REPO_A], current: snapshotFor(REPO_A) });
  });

  test('stops publishing when the restarted server lacks the capability', async () => {
    await startService();
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    transport.emitRestart({ sha: 'sha', version: 'version', capabilities: [] });
    await flushPromises();
    assert.deepStrictEqual({ current: service.current, changes }, { current: undefined, changes: 2 });
  });

  test('asks and publishes nothing, even for a pushed snapshot, until sign-in has settled', async () => {
    await startService();
    service.setContext({ active: true, settled: false, repoPath: REPO_A });
    transport.notify(snapshotFor(REPO_A, 'no-project'));
    await flushPromises();
    assert.deepStrictEqual(
      { requests: transport.requests, current: service.current, changes },
      { requests: [], current: undefined, changes: 0 }
    );
  });

  test('requests and publishes once sign-in settles, and keeps publishing while it settles again', async () => {
    await startService();
    service.setContext({ active: true, settled: false, repoPath: REPO_A });
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    service.setContext({ active: true, settled: false, repoPath: REPO_A });
    assert.deepStrictEqual(
      { requested: requestedRepos(), current: service.current, changes },
      { requested: [REPO_A], current: snapshotFor(REPO_A), changes: 1 }
    );
  });

  test('keeps running when the request fails', async () => {
    await startService();
    transport.failRequests(new Error('boom'));
    service.setContext({ active: true, settled: true, repoPath: REPO_A });
    await flushPromises();
    assert.deepStrictEqual({ current: service.current, changes }, { current: undefined, changes: 0 });
  });
});

suite('activateObjectives', () => {
  const settledCases: Array<{ status: AuthStatusFixture; syncing: boolean; requested: string[] }> = [
    { status: 'signed-in-oauth', syncing: false, requested: [REPO_A] },
    { status: 'signed-in-network-error', syncing: false, requested: [REPO_A] },
    { status: 'signed-in-oauth', syncing: true, requested: [] },
    { status: 'signed-in-refused', syncing: false, requested: [] },
    { status: 'signed-in-offline-expired', syncing: false, requested: [] },
    { status: 'signed-out', syncing: false, requested: [] },
  ];

  for (const { status, syncing, requested } of settledCases) {
    test(`${requested.length ? 'loads' : 'does not load'} objectives when ${status}${syncing ? ' and syncing' : ''}`, async () => {
      const transport = new FakeObjectivesTransport(
        { sha: 'sha', version: 'version', capabilities: [OBJECTIVES_CAPABILITY] },
        (repoPath) => snapshotFor(repoPath)
      );
      const feature = activateObjectives(transport);
      await flushPromises();

      feature.update({ active: true, status: authStatusFixture(status), syncing, repo: { path: REPO_A, name: 'repo-a' } });
      await flushPromises();

      assert.deepStrictEqual(
        transport.requests.map((request) => (request.params as Record<string, string>)['repo-path']),
        requested
      );
      feature.disposables.forEach((disposable) => disposable.dispose());
    });
  }
});
