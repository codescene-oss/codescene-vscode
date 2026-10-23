import * as assert from 'assert';
import { INACTIVE_SNAPSHOT, toAuthPayload } from '../../auth/auth-payload';
import { AuthService } from '../../auth/auth-service';
import { FakeAuthSettings } from '../fakes/fake-auth-settings';
import { FakeAuthTransport, flushPromises } from '../fakes/fake-auth-transport';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';
import { assertLogOmits } from '../setup';

interface Harness {
  service: AuthService;
  transport: FakeAuthTransport;
  settings: FakeAuthSettings;
  events: Array<{ name: string; data?: Record<string, unknown> }>;
  opened: string[];
}

interface HarnessOptions {
  capabilities?: string[];
  signInEnabled?: boolean;
  accessToken?: string;
}

const NULL_CONFIGURATION = { 'server-url': null, 'access-token': null };

function createHarness(options: HarnessOptions = {}): Harness {
  const transport = new FakeAuthTransport({ sha: 'sha', version: 'version', capabilities: options.capabilities ?? ['auth-v1'] })
    .respond('cs-ide/auth-configure', () => authStatusFixture('signed-out'))
    .respond('cs-ide/auth-list-accounts', () => [])
    .respond('cs-ide/projects-list', () => [])
    .respond('cs-ide/project-link-get', () => ({ project: null }));
  const settings = new FakeAuthSettings({
    signInEnabled: options.signInEnabled ?? true,
    serverUrl: '',
    accessToken: options.accessToken ?? '',
  });
  const events: Harness['events'] = [];
  const opened: string[] = [];
  const service = new AuthService({
    transport,
    settings,
    openExternal: async (url) => {
      opened.push(url);
    },
    logUsage: (name, data) => events.push(data ? { name, data } : { name }),
  });
  return { service, transport, settings, events, opened };
}

suite('AuthService', () => {
  let harness: Harness;

  teardown(() => harness.service.dispose());

  test('stays inactive when cs-ide does not report auth-v1', async () => {
    harness = createHarness({ capabilities: [] });
    await harness.service.start();
    assert.deepStrictEqual(
      { requests: harness.transport.requests, snapshot: harness.service.current },
      { requests: [], snapshot: INACTIVE_SNAPSHOT }
    );
  });

  test('stays inactive while the toggle is off', async () => {
    harness = createHarness({ signInEnabled: false });
    await harness.service.start();
    assert.deepStrictEqual(
      { requests: harness.transport.requests, restarts: harness.transport.restarts, snapshot: harness.service.current },
      { requests: [], restarts: 0, snapshot: INACTIVE_SNAPSHOT }
    );
  });

  test('does not restart cs-ide for setting changes while the toggle is off', async () => {
    harness = createHarness({ signInEnabled: false });
    await harness.service.start();
    harness.settings.update({ serverUrl: 'https://cs.example' });
    await flushPromises();
    assert.deepStrictEqual(
      { requests: harness.transport.requests, restarts: harness.transport.restarts },
      { requests: [], restarts: 0 }
    );
  });

  test('configures cs-ide on start and publishes the returned status', async () => {
    harness = createHarness();
    await harness.service.start();
    assert.deepStrictEqual(harness.transport.requests, [{ method: 'cs-ide/auth-configure', params: NULL_CONFIGURATION }]);
    assert.deepStrictEqual(toAuthPayload(harness.service.current), {
      status: authStatusFixture('signed-out'),
      accounts: null,
      projects: null,
      repo: null,
      'linked-project': null,
    });
  });

  test('configures cs-ide again after a restart', async () => {
    harness = createHarness();
    await harness.service.start();
    harness.transport.emitRestart();
    await flushPromises();
    assert.deepStrictEqual(harness.transport.methods(), ['cs-ide/auth-configure', 'cs-ide/auth-configure']);
  });

  test('turns inactive when a restarted cs-ide no longer reports auth-v1', async () => {
    harness = createHarness();
    await harness.service.start();
    harness.transport.emitRestart({ sha: 'old', version: 'old' });
    await flushPromises();
    assert.deepStrictEqual(
      { snapshot: harness.service.current, restarts: harness.transport.restarts },
      { snapshot: INACTIVE_SNAPSHOT, restarts: 0 }
    );
  });

  test('configures cs-ide again when the server URL or token changes', async () => {
    harness = createHarness();
    await harness.service.start();
    harness.settings.update({ serverUrl: 'https://cs.example', accessToken: 'pat-1' });
    await flushPromises();
    assert.deepStrictEqual(harness.transport.requests[1], {
      method: 'cs-ide/auth-configure',
      params: { 'server-url': 'https://cs.example', 'access-token': 'pat-1' },
    });
  });

  test('publishes the invalid-token warning when cs-ide skips a rejected setting token', async () => {
    harness = createHarness({ accessToken: 'secret-pat-123' });
    harness.transport.respond('cs-ide/auth-configure', () => authStatusFixture('signed-in-oauth-setting-token-rejected'));
    await harness.service.start();
    assert.deepStrictEqual(
      {
        status: harness.service.current.status,
        statusCalls: harness.transport.methods().filter((method) => method === 'cs-ide/auth-status'),
      },
      { status: authStatusFixture('signed-in-oauth-setting-token-rejected'), statusCalls: [] }
    );
    assertLogOmits('secret-pat-123');
  });

  test('keeps the last status when auth-configure fails', async () => {
    harness = createHarness();
    await harness.service.start();
    harness.transport.respond('cs-ide/auth-configure', () => {
      throw new Error('connection closed');
    });
    harness.settings.update({ accessToken: 'pat-1' });
    await flushPromises();
    assert.deepStrictEqual(
      { methods: harness.transport.methods(), status: harness.service.current.status },
      { methods: ['cs-ide/auth-configure', 'cs-ide/auth-configure'], status: authStatusFixture('signed-out') }
    );
  });

  test('keeps the latest notified status', async () => {
    harness = createHarness();
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signing-in'));
    assert.deepStrictEqual(harness.service.current.status, authStatusFixture('signing-in'));
  });

  test('ignores status notifications while inactive', async () => {
    harness = createHarness({ signInEnabled: false });
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signed-in-oauth'));
    assert.deepStrictEqual(harness.service.current, INACTIVE_SNAPSHOT);
  });

  test('turns inactive and restarts cs-ide once when the toggle is switched off', async () => {
    harness = createHarness();
    await harness.service.start();
    harness.settings.update({ signInEnabled: false });
    await flushPromises();
    assert.deepStrictEqual(
      {
        payload: toAuthPayload(harness.service.current),
        restarts: harness.transport.restarts,
        methods: harness.transport.methods(),
      },
      { payload: undefined, restarts: 1, methods: ['cs-ide/auth-configure'] }
    );
  });

  test('configures the fresh cs-ide again when the toggle is switched back on', async () => {
    harness = createHarness();
    await harness.service.start();
    harness.settings.update({ signInEnabled: false });
    await flushPromises();
    harness.settings.update({ signInEnabled: true });
    await flushPromises();
    assert.deepStrictEqual(
      { restarts: harness.transport.restarts, methods: harness.transport.methods(), state: harness.service.current.status?.state },
      { restarts: 1, methods: ['cs-ide/auth-configure', 'cs-ide/auth-configure'], state: 'signed-out' }
    );
  });

  test('reports sign-in completion and failure from status transitions', async () => {
    harness = createHarness();
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signing-in'));
    harness.transport.notify(authStatusFixture('signed-in-oauth'));
    harness.transport.notify(authStatusFixture('signing-in'));
    harness.transport.notify(authStatusFixture('signed-out-timeout'));
    assert.deepStrictEqual(harness.events, [
      { name: 'auth/sign-in-completed' },
      { name: 'auth/sign-in-failed', data: { 'error-code': 'auth/timeout' } },
    ]);
  });

  test('fires one change event per distinct snapshot', async () => {
    harness = createHarness();
    const states: Array<string | undefined> = [];
    harness.service.onDidChange((snapshot) => states.push(snapshot.status?.state));
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signed-out'));
    assert.deepStrictEqual(states, ['signed-out']);
  });
});
