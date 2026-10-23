import * as assert from 'assert';
import { INACTIVE_SNAPSHOT, toAuthPayload } from '../../auth/auth-payload';
import { AuthService } from '../../auth/auth-service';
import { FakeAuthSettings } from '../fakes/fake-auth-settings';
import type { AuthStatus } from '../../centralized-webview-framework/types/auth';
import { authRpcError, FakeAuthTransport, flushPromises } from '../fakes/fake-auth-transport';
import { authPayloadFixture, authStatusFixture } from '../fixtures/auth/auth-fixtures';
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

  test('does not call cs-ide on retry while the toggle is off', async () => {
    harness = createHarness({ signInEnabled: false });
    await harness.service.start();
    await harness.service.retry();
    assert.deepStrictEqual(
      { requests: harness.transport.requests, methods: harness.transport.methods() },
      { requests: [], methods: [] }
    );
  });

  test('refreshes status on retry while active', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-status', () => authStatusFixture('signed-in-oauth'));
    await harness.service.start();
    await harness.service.retry();
    assert.deepStrictEqual(
      { methods: harness.transport.methods(), status: harness.service.current.status },
      {
        methods: ['cs-ide/auth-configure', 'cs-ide/auth-status', 'cs-ide/auth-list-accounts', 'cs-ide/projects-list'],
        status: authStatusFixture('signed-in-oauth'),
      }
    );
  });
});

suite('AuthService account data', () => {
  const repo = { path: 'C:\\git\\acme-backend', name: 'acme-backend' };
  let harness: Harness;

  teardown(() => harness.service.dispose());

  test('loads accounts, projects and the repo link once signed in', async () => {
    const expected = authPayloadFixture('auth-payload-account-pick');
    harness = createHarness();
    harness.transport
      .respond('cs-ide/auth-list-accounts', () => expected.accounts)
      .respond('cs-ide/projects-list', () => expected.projects);
    await harness.service.start();
    await harness.service.setRepo(repo);
    harness.transport.notify(authStatusFixture('signed-in-oauth'));
    await flushPromises();
    assert.deepStrictEqual(toAuthPayload(harness.service.current), expected);
  });

  test('loads the link when a repo is selected after sign-in', async () => {
    const expected = authPayloadFixture('auth-payload-linked-project');
    harness = createHarness();
    harness.transport
      .respond('cs-ide/auth-list-accounts', () => expected.accounts)
      .respond('cs-ide/projects-list', () => expected.projects)
      .respond('cs-ide/project-link-get', (params) => ({
        project: params['repo-path'] === repo.path ? { id: '101', name: 'acme-backend' } : null,
      }));
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signed-in-oauth'));
    await flushPromises();
    await harness.service.setRepo(repo);
    assert.deepStrictEqual(toAuthPayload(harness.service.current), expected);
  });

  test('clears account data after sign-out', async () => {
    harness = createHarness();
    harness.transport
      .respond('cs-ide/auth-list-accounts', () => authPayloadFixture('auth-payload-account-pick').accounts)
      .respond('cs-ide/auth-logout', () => authStatusFixture('signed-out'));
    await harness.service.start();
    await harness.service.setRepo(repo);
    harness.transport.notify(authStatusFixture('signed-in-oauth'));
    await flushPromises();
    await harness.service.signOut();
    await flushPromises();
    assert.deepStrictEqual(
      { payload: toAuthPayload(harness.service.current), events: harness.events },
      {
        payload: { status: authStatusFixture('signed-out'), accounts: null, projects: null, repo, 'linked-project': null },
        events: [{ name: 'auth/sign-out' }],
      }
    );
  });

  test('keeps working when account requests fail', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-list-accounts', () => {
      throw authRpcError('auth/network');
    });
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signed-in-oauth'));
    await flushPromises();
    assert.deepStrictEqual(
      { accounts: harness.service.current.accounts, projects: harness.service.current.projects },
      { accounts: null, projects: [] }
    );
  });
});

suite('AuthService actions', () => {
  const authorizeUrl = 'https://codescene.io/oauth2/auth?state=xyz';
  const cancelled: AuthStatus = {
    ...authStatusFixture('signed-out'),
    'oauth-supported': true,
    error: { code: 'auth/cancelled', message: 'Sign-in was cancelled.' },
  };
  let harness: Harness;

  teardown(() => harness.service.dispose());

  test('sign-in opens the authorize URL returned by auth-login', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-login', () => ({ 'login-id': '3f1c9a2e', 'authorize-url': authorizeUrl }));
    await harness.service.start();
    await harness.service.signIn();
    assert.deepStrictEqual(
      { opened: harness.opened, events: harness.events },
      { opened: [authorizeUrl], events: [{ name: 'auth/sign-in-started' }] }
    );
  });

  test('a failed auth-login reports the error code and requests nothing else', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-login', () => {
      throw authRpcError('auth/port-unavailable');
    });
    await harness.service.start();
    await harness.service.signIn();
    assert.deepStrictEqual(
      { methods: harness.transport.methods(), opened: harness.opened, events: harness.events },
      {
        methods: ['cs-ide/auth-configure', 'cs-ide/auth-login'],
        opened: [],
        events: [
          { name: 'auth/sign-in-started' },
          { name: 'auth/sign-in-failed', data: { 'error-code': 'auth/port-unavailable' } },
        ],
      }
    );
  });

  test('open-browser-again re-opens the pending authorize URL', async () => {
    harness = createHarness();
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signing-in'));
    await harness.service.openBrowserAgain();
    assert.deepStrictEqual(harness.opened, [authStatusFixture('signing-in').login?.['authorize-url']]);
  });

  test('cancel sends the pending login id and reports the cancellation', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-cancel-login', () => cancelled);
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signing-in'));
    await harness.service.cancelSignIn();
    assert.deepStrictEqual(
      { last: harness.transport.requests.at(-1), status: harness.service.current.status, events: harness.events },
      {
        last: { method: 'cs-ide/auth-cancel-login', params: { 'login-id': '3f1c9a2e' } },
        status: cancelled,
        events: [{ name: 'auth/sign-in-cancelled' }],
      }
    );
  });

  test('retry applies the auth-status result', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-status', () => authStatusFixture('signed-in-network-error'));
    await harness.service.start();
    await harness.service.retry();
    assert.deepStrictEqual(harness.service.current.status, authStatusFixture('signed-in-network-error'));
  });

  test('selecting an account without a local session opens its authorize URL', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-select-account', () => authStatusFixture('signing-in'));
    await harness.service.start();
    await harness.service.selectAccount('7');
    assert.deepStrictEqual(
      { last: harness.transport.requests.at(-1), opened: harness.opened, events: harness.events },
      {
        last: { method: 'cs-ide/auth-select-account', params: { 'account-id': '7' } },
        opened: [authStatusFixture('signing-in').login?.['authorize-url']],
        events: [{ name: 'auth/sign-in-started' }],
      }
    );
  });

  test('selecting an account with a local session opens no browser', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-select-account', () => authStatusFixture('signed-in-oauth'));
    await harness.service.start();
    await harness.service.selectAccount('42');
    assert.deepStrictEqual(
      { opened: harness.opened, status: harness.service.current.status },
      { opened: [], status: authStatusFixture('signed-in-oauth') }
    );
  });

  test('link-project stores the link for the current repo', async () => {
    const repo = { path: 'C:\\git\\acme-backend', name: 'acme-backend' };
    harness = createHarness();
    harness.transport.respond('cs-ide/project-link-set', () => ({ project: { id: '102', name: 'acme-frontend' } }));
    await harness.service.start();
    await harness.service.setRepo(repo);
    await harness.service.linkProject('102');
    assert.deepStrictEqual(
      { last: harness.transport.requests.at(-1), linked: harness.service.current.linkedProject },
      {
        last: { method: 'cs-ide/project-link-set', params: { 'repo-path': repo.path, 'project-id': '102' } },
        linked: { id: '102', name: 'acme-frontend' },
      }
    );
  });

  test('setting and removing the access token writes the setting and configures cs-ide again', async () => {
    harness = createHarness();
    await harness.service.start();
    await harness.service.setAccessToken('pat-1');
    await flushPromises();
    await harness.service.removeAccessToken();
    await flushPromises();
    assert.deepStrictEqual(
      {
        writes: harness.settings.tokenWrites,
        configurations: harness.transport.requests
          .filter((request) => request.method === 'cs-ide/auth-configure')
          .map((request) => request.params),
        events: harness.events,
      },
      {
        writes: ['pat-1', undefined],
        configurations: [NULL_CONFIGURATION, { 'server-url': null, 'access-token': 'pat-1' }, NULL_CONFIGURATION],
        events: [{ name: 'auth/pat-set' }, { name: 'auth/pat-removed' }],
      }
    );
  });
});
