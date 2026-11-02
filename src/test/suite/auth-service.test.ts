import * as assert from 'assert';
import { INACTIVE_SNAPSHOT, toAuthFlow, toAuthPayload, type AuthRepo, type AuthSnapshot } from '../../auth/auth-payload';
import { AuthService } from '../../auth/auth-service';
import { FakeAuthSettings } from '../fakes/fake-auth-settings';
import type { Account, AuthStatus, Project } from '../../centralized-webview-framework/types/auth';
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
    .respond('cs-ide/project-link-get', () => ({ project: null }))
    .respond('cs-ide/auth-sync-account', () => {
      throw Object.assign(new Error('Method not found'), { code: -32601 });
    });
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

  test('configures cs-ide when the first start fails and a later start event is not a restart', async () => {
    harness = createHarness();
    harness.transport.failStart(new Error('start failed'));
    await assert.rejects(harness.service.start(), /start failed/);
    harness.transport.emitStart();
    await flushPromises();
    assert.deepStrictEqual(harness.transport.requests, [{ method: 'cs-ide/auth-configure', params: NULL_CONFIGURATION }]);
  });

  test('configures cs-ide once when a start event precedes the resolved start', async () => {
    harness = createHarness();
    harness.transport.start = async () => {
      harness.transport.emitStart();
      return { sha: 'sha', version: 'version', capabilities: ['auth-v1'] };
    };
    await harness.service.start();
    await flushPromises();
    assert.deepStrictEqual(harness.transport.methods(), ['cs-ide/auth-configure']);
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

  test('publishes how the link was found when account data loads', async () => {
    const project = { id: '101', name: 'acme-backend' };
    const cases = [
      { name: 'git remote', response: { project, source: 'remote' }, expected: { linkedProject: project, projectSource: 'remote' } },
      { name: 'manual link', response: { project, source: 'link' }, expected: { linkedProject: project, projectSource: 'link' } },
      { name: 'no link', response: { project: null }, expected: { linkedProject: null, projectSource: null } },
    ];
    for (const { name, response, expected } of cases) {
      harness = createHarness();
      harness.transport.respond('cs-ide/project-link-get', () => response);
      await harness.service.setRepo(repo);
      await harness.service.start();
      harness.transport.notify(authStatusFixture('signed-in-oauth'));
      await flushPromises();
      const { linkedProject, projectSource } = harness.service.current;
      assert.deepStrictEqual({ linkedProject, projectSource }, expected, name);
      harness.service.dispose();
    }
  });

  test('publishes the source of the link for a newly selected repo', async () => {
    const project = { id: '101', name: 'acme-backend' };
    harness = createHarness();
    harness.transport.respond('cs-ide/project-link-get', (params) =>
      params['repo-path'] === repo.path ? { project, source: 'remote' } : { project: null }
    );
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signed-in-oauth'));
    await flushPromises();
    await harness.service.setRepo(repo);
    assert.deepStrictEqual(
      { linkedProject: harness.service.current.linkedProject, projectSource: harness.service.current.projectSource },
      { linkedProject: project, projectSource: 'remote' }
    );
  });

  test('clears the link and source when the next repo has no link', async () => {
    const project = { id: '101', name: 'acme-backend' };
    harness = createHarness();
    harness.transport.respond('cs-ide/project-link-get', () => ({ project, source: 'remote' }));
    await harness.service.start();
    harness.transport.notify(authStatusFixture('signed-in-oauth'));
    await flushPromises();
    await harness.service.setRepo(repo);
    harness.transport.respond('cs-ide/project-link-get', () => ({ project: null }));
    await harness.service.setRepo({ path: 'C:\git\other-web', name: 'other-web' });
    assert.deepStrictEqual(
      { linkedProject: harness.service.current.linkedProject, projectSource: harness.service.current.projectSource },
      { linkedProject: null, projectSource: null }
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

suite('AuthService account sync', () => {
  const repo = { path: 'C:\\git\\acme-backend', name: 'acme-backend' };
  const otherRepo = { path: 'C:\\git\\other-web', name: 'other-web' };
  const signedIn = authStatusFixture('signed-in-oauth');
  const switched: AuthStatus = { ...signedIn, account: { id: '7', name: 'Other Corp' } };
  let harness: Harness;

  teardown(() => harness.service.dispose());

  const syncedPaths = () =>
    harness.transport.requests
      .filter((request) => request.method === 'cs-ide/auth-sync-account')
      .map((request) => (request.params as Record<string, unknown>)['repo-path']);

  const signInTo = async (status: AuthStatus = signedIn) => {
    harness.transport.notify(status);
    await flushPromises();
  };

  test('moves to the repository account when signing in and reloads its account data', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-sync-account', () => switched);
    await harness.service.setRepo(repo);
    await harness.service.start();
    await signInTo();
    assert.deepStrictEqual(
      {
        synced: syncedPaths(),
        account: harness.service.current.status?.account,
        accountLists: harness.transport.methods().filter((method) => method === 'cs-ide/auth-list-accounts').length,
      },
      { synced: [repo.path], account: switched.account, accountLists: 2 }
    );
  });

  test('asks nothing without a repository, then asks when one is selected', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-sync-account', () => signedIn);
    await harness.service.start();
    await signInTo();
    const before = syncedPaths();
    await harness.service.setRepo(repo);
    assert.deepStrictEqual({ before, after: syncedPaths() }, { before: [], after: [repo.path] });
  });

  test('asks again when another repository is selected and loads its link under the resulting account', async () => {
    harness = createHarness();
    harness.transport
      .respond('cs-ide/auth-sync-account', (params) => (params['repo-path'] === otherRepo.path ? switched : signedIn))
      .respond('cs-ide/project-link-get', (params) => ({
        project: params['repo-path'] === otherRepo.path ? { id: '201', name: 'other-web' } : null,
      }));
    await harness.service.setRepo(repo);
    await harness.service.start();
    await signInTo();
    await harness.service.setRepo(otherRepo);
    await flushPromises();
    assert.deepStrictEqual(
      {
        synced: syncedPaths(),
        account: harness.service.current.status?.account,
        linked: harness.service.current.linkedProject,
      },
      { synced: [repo.path, otherRepo.path], account: switched.account, linked: { id: '201', name: 'other-web' } }
    );
  });

  test('leaves the account the user picked alone', async () => {
    harness = createHarness();
    harness.transport
      .respond('cs-ide/auth-sync-account', () => signedIn)
      .respond('cs-ide/auth-select-account', () => switched);
    await harness.service.setRepo(repo);
    await harness.service.start();
    await signInTo();
    await harness.service.selectAccount('7');
    await flushPromises();
    assert.deepStrictEqual(
      { synced: syncedPaths(), account: harness.service.current.status?.account },
      { synced: [repo.path], account: switched.account }
    );
  });

  test('asks again after signing out and in', async () => {
    harness = createHarness();
    harness.transport
      .respond('cs-ide/auth-sync-account', () => signedIn)
      .respond('cs-ide/auth-logout', () => authStatusFixture('signed-out'))
      .respond('cs-ide/auth-login', () => ({ 'login-id': 'abc', 'authorize-url': 'https://codescene.io/oauth2/auth' }));
    await harness.service.setRepo(repo);
    await harness.service.start();
    await signInTo();
    await harness.service.signOut();
    await harness.service.signIn();
    await signInTo();
    assert.deepStrictEqual(syncedPaths(), [repo.path, repo.path]);
  });

  test('stops asking a cs-ide that does not know the method, and still loads the link', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/project-link-get', (params) => ({
      project: params['repo-path'] === otherRepo.path ? { id: '201', name: 'other-web' } : null,
    }));
    await harness.service.setRepo(repo);
    await harness.service.start();
    await signInTo();
    await harness.service.setRepo(otherRepo);
    assert.deepStrictEqual(
      { synced: syncedPaths(), linked: harness.service.current.linkedProject },
      { synced: [repo.path], linked: { id: '201', name: 'other-web' } }
    );
  });

  test('keeps the account and keeps asking when a request fails', async () => {
    harness = createHarness();
    harness.transport.respond('cs-ide/auth-sync-account', () => {
      throw authRpcError('auth/network');
    });
    await harness.service.setRepo(repo);
    await harness.service.start();
    await signInTo();
    await harness.service.setRepo(otherRepo);
    assert.deepStrictEqual(
      { synced: syncedPaths(), status: harness.service.current.status },
      { synced: [repo.path, otherRepo.path], status: signedIn }
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

  test('link-project marks a chosen project as manually linked', async () => {
    const repo = { path: 'C:\git\acme-backend', name: 'acme-backend' };
    harness = createHarness();
    harness.transport.respond('cs-ide/project-link-set', () => ({ project: { id: '102', name: 'acme-frontend' } }));
    await harness.service.start();
    await harness.service.setRepo(repo);
    await harness.service.linkProject('102');
    assert.deepStrictEqual(
      { project: harness.service.current.linkedProject, source: harness.service.current.projectSource },
      { project: { id: '102', name: 'acme-frontend' }, source: 'link' }
    );
  });

  test('link-project with null resets the link and publishes the re-read result', async () => {
    const repo = { path: 'C:\git\acme-backend', name: 'acme-backend' };
    const project = { id: '101', name: 'acme-backend' };
    const cases = [
      { name: 'git remote match', get: { project, source: 'remote' }, expected: { project, source: 'remote' } },
      { name: 'nothing found', get: { project: null }, expected: { project: null, source: null } },
    ];
    for (const { name, get, expected } of cases) {
      harness = createHarness();
      harness.transport.respond('cs-ide/project-link-set', () => ({ project: null }));
      await harness.service.start();
      await harness.service.setRepo(repo);
      harness.transport.respond('cs-ide/project-link-get', () => get);
      await harness.service.linkProject(null);
      assert.deepStrictEqual(
        {
          methods: harness.transport.methods().slice(-2),
          project: harness.service.current.linkedProject,
          source: harness.service.current.projectSource,
        },
        { methods: ['cs-ide/project-link-set', 'cs-ide/project-link-get'], ...expected },
        name
      );
      harness.service.dispose();
    }
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

suite('AuthService sign-in flow', () => {
  const repo = { path: 'C:\\git\\acme-backend', name: 'acme-backend' };
  const project = { id: '101', name: 'acme-backend' };
  const projects: Project[] = [project, { id: '102', name: 'acme-frontend' }];
  const accountA: Account = { id: '42', name: 'Acme Corp', 'signed-in-locally': true };
  const accountB: Account = { id: '7', name: 'CodeScene OSS', 'signed-in-locally': false };
  const signedIn = authStatusFixture('signed-in-oauth');
  const switched: AuthStatus = { ...signedIn, account: { id: '7', name: 'CodeScene OSS' } };
  let harness: Harness;
  let published: AuthSnapshot[];

  interface FlowOptions {
    accounts?: Account[];
    link?: () => unknown;
    repo?: AuthRepo | null;
    sync?: () => unknown;
    configure?: AuthStatus;
  }

  teardown(() => harness.service.dispose());

  const view = () => {
    const { surface, step, context, syncing } = harness.service.current;
    return { surface, step, context, syncing };
  };

  const trail = () => published.map((snapshot) => snapshot.step).filter((step, index, all) => step !== all[index - 1]);

  async function prepare(options: FlowOptions = {}): Promise<void> {
    harness = createHarness();
    harness.transport
      .respond('cs-ide/auth-configure', () => options.configure ?? authStatusFixture('signed-out'))
      .respond('cs-ide/auth-login', () => ({ 'login-id': 'abc', 'authorize-url': 'https://codescene.io/oauth2/auth' }))
      .respond('cs-ide/auth-list-accounts', () => options.accounts ?? [accountA])
      .respond('cs-ide/projects-list', () => projects)
      .respond('cs-ide/project-link-get', options.link ?? (() => ({ project: null })));
    if (options.sync) harness.transport.respond('cs-ide/auth-sync-account', options.sync);
    published = [];
    harness.service.onDidChange((snapshot) => published.push(snapshot));
    if (options.repo !== null) await harness.service.setRepo(options.repo ?? repo);
    await harness.service.start();
    await flushPromises();
  }

  async function signInWith(options: FlowOptions = {}): Promise<void> {
    await prepare(options);
    await harness.service.signIn();
    harness.transport.notify(signedIn);
    await flushPromises();
  }

  const syncSwitchingToOwner = (): FlowOptions => {
    let synced = false;
    return {
      accounts: [accountA, accountB],
      sync: async () => {
        await flushPromises();
        synced = true;
        return switched;
      },
      link: () => (synced ? { project, source: 'remote' } : { project: null }),
    };
  };

  const twoAccountsUnlinked: FlowOptions = { accounts: [accountA, accountB], sync: () => signedIn };

  const monitor = { surface: 'monitor', step: 'summary', context: 'manual', syncing: false };

  test('starting a sign-in opens the auth view', async () => {
    await prepare();
    await harness.service.signIn();
    assert.deepStrictEqual(view(), { surface: 'auth', step: 'summary', context: 'sign-in', syncing: true });
  });

  const resolutions: Array<{ name: string; options: () => FlowOptions; expected: { view: object; trail: string[] } }> = [
    {
      name: 'one account and a project found from the git remote returns to the monitor without a picker',
      options: () => ({ link: () => ({ project, source: 'remote' }) }),
      expected: { view: monitor, trail: ['summary', 'resolving', 'summary'] },
    },
    {
      name: 'two accounts where the sync moves to the owner and the project resolves skip the account picker',
      options: syncSwitchingToOwner,
      expected: { view: monitor, trail: ['summary', 'resolving', 'summary'] },
    },
    {
      name: 'two accounts where the sync changes nothing and no project resolves offer the account picker',
      options: () => twoAccountsUnlinked,
      expected: {
        view: { surface: 'auth', step: 'pick-account', context: 'sign-in', syncing: false },
        trail: ['summary', 'resolving', 'pick-account'],
      },
    },
    {
      name: 'an unsupported account sync with one account and no project offers the project picker',
      options: () => ({}),
      expected: {
        view: { surface: 'auth', step: 'pick-project', context: 'sign-in', syncing: false },
        trail: ['summary', 'resolving', 'pick-project'],
      },
    },
    {
      name: 'an unsupported account sync without a repo returns to the monitor',
      options: () => ({ repo: null }),
      expected: { view: monitor, trail: ['summary', 'resolving', 'summary'] },
    },
  ];

  resolutions.forEach(({ name, options, expected }) => {
    test(name, async () => {
      await signInWith(options());
      assert.deepStrictEqual({ view: view(), trail: trail() }, expected);
    });
  });

  test('choosing an account re-resolves the project and offers the project picker when still unlinked', async () => {
    await signInWith(twoAccountsUnlinked);
    harness.transport.respond('cs-ide/auth-select-account', () => switched);
    await harness.service.selectAccount('7');
    await flushPromises();
    assert.deepStrictEqual(
      { view: view(), trail: trail() },
      {
        view: { surface: 'auth', step: 'pick-project', context: 'sign-in', syncing: false },
        trail: ['summary', 'resolving', 'pick-account', 'resolving', 'pick-project'],
      }
    );
  });

  test('choosing an account that needs a browser login does not offer the account picker again', async () => {
    await signInWith(twoAccountsUnlinked);
    harness.transport.respond('cs-ide/auth-select-account', () => authStatusFixture('signing-in'));
    await harness.service.selectAccount('7');
    harness.transport.notify(switched);
    await flushPromises();
    assert.deepStrictEqual(
      { view: view(), trail: trail() },
      {
        view: { surface: 'auth', step: 'pick-project', context: 'sign-in', syncing: false },
        trail: ['summary', 'resolving', 'pick-account', 'summary', 'resolving', 'pick-project'],
      }
    );
  });

  test('skipping the project step returns to the monitor', async () => {
    await signInWith();
    const before = view().step;
    harness.service.skipProject();
    assert.deepStrictEqual({ before, after: view() }, { before: 'pick-project', after: monitor });
  });

  test('linking a project in the project step returns to the monitor', async () => {
    await signInWith();
    harness.transport.respond('cs-ide/project-link-set', () => ({ project }));
    const before = view().step;
    await harness.service.linkProject(project.id);
    assert.deepStrictEqual(
      { before, after: view(), linked: harness.service.current.linkedProject },
      { before: 'pick-project', after: monitor, linked: project }
    );
  });

  test('closing while resolving ignores the late sync result', async () => {
    let release: (status: AuthStatus) => void = () => undefined;
    const pending = new Promise<AuthStatus>((resolve) => (release = resolve));
    await signInWith({ ...syncSwitchingToOwner(), sync: () => pending });
    const before = view();
    await harness.service.closeAuth();
    const closedAt = published.length;
    release(switched);
    await flushPromises();
    assert.deepStrictEqual(
      {
        before,
        after: view(),
        reopened: published.slice(closedAt).some((snapshot) => snapshot.surface === 'auth'),
        account: harness.service.current.status?.account,
      },
      {
        before: { surface: 'auth', step: 'resolving', context: 'sign-in', syncing: true },
        after: monitor,
        reopened: false,
        account: switched.account,
      }
    );
  });

  test('closing while signing in cancels the pending login and ends the flow', async () => {
    await prepare();
    harness.transport.respond('cs-ide/auth-cancel-login', () => authStatusFixture('signed-out'));
    await harness.service.signIn();
    harness.transport.notify(authStatusFixture('signing-in'));
    await harness.service.closeAuth();
    assert.deepStrictEqual(
      { last: harness.transport.requests.at(-1), view: view() },
      { last: { method: 'cs-ide/auth-cancel-login', params: { 'login-id': '3f1c9a2e' } }, view: monitor }
    );
  });

  test('closing while the login request is pending cancels that login instead of opening the browser', async () => {
    let release: (login: unknown) => void = () => undefined;
    await prepare();
    harness.transport
      .respond('cs-ide/auth-login', () => new Promise((resolve) => (release = resolve)))
      .respond('cs-ide/auth-cancel-login', () => authStatusFixture('signed-out'));
    const signingIn = harness.service.signIn();
    await harness.service.closeAuth();
    release({ 'login-id': 'abc', 'authorize-url': 'https://codescene.io/oauth2/auth' });
    await signingIn;
    assert.deepStrictEqual(
      { opened: harness.opened, last: harness.transport.requests.at(-1), view: view() },
      { opened: [], last: { method: 'cs-ide/auth-cancel-login', params: { 'login-id': 'abc' } }, view: monitor }
    );
  });

  test('closing while an account choice is pending cancels its login instead of opening the browser', async () => {
    let release: (status: AuthStatus) => void = () => undefined;
    await signInWith(twoAccountsUnlinked);
    harness.transport
      .respond('cs-ide/auth-select-account', () => new Promise((resolve) => (release = resolve)))
      .respond('cs-ide/auth-cancel-login', () => authStatusFixture('signed-out'));
    const openedBefore = [...harness.opened];
    const selecting = harness.service.selectAccount('7');
    await harness.service.closeAuth();
    release(authStatusFixture('signing-in'));
    await selecting;
    await flushPromises();
    assert.deepStrictEqual(
      { opened: harness.opened, last: harness.transport.requests.at(-1), view: view() },
      {
        opened: openedBefore,
        last: { method: 'cs-ide/auth-cancel-login', params: { 'login-id': '3f1c9a2e' } },
        view: monitor,
      }
    );
  });

  test('a session already signed in at startup does not start the flow', async () => {
    await prepare({ ...twoAccountsUnlinked, configure: signedIn });
    assert.deepStrictEqual({ view: view(), trail: trail() }, { view: monitor, trail: ['summary'] });
  });

  test('turning the toggle off while the auth view is open returns to the monitor', async () => {
    await signInWith(twoAccountsUnlinked);
    const before = view().surface;
    harness.settings.update({ signInEnabled: false });
    await flushPromises();
    assert.deepStrictEqual({ before, after: view() }, { before: 'auth', after: monitor });
  });

  test('reports syncing while a newly selected repo looks up its link', async () => {
    let release: (link: unknown) => void = () => undefined;
    await prepare({ configure: signedIn, repo: null });
    harness.transport.respond('cs-ide/project-link-get', () => new Promise((resolve) => (release = resolve)));
    const selecting = harness.service.setRepo(repo);
    await flushPromises();
    const during = harness.service.current.syncing;
    release({ project, source: 'remote' });
    await selecting;
    assert.deepStrictEqual(
      { during, after: harness.service.current.syncing, linked: harness.service.current.linkedProject },
      { during: true, after: false, linked: project }
    );
  });

  const accountBLocal: Account = { ...accountB, 'signed-in-locally': true };
  const manualOptions: FlowOptions = { configure: signedIn, accounts: [accountA, accountBLocal] };
  const manualView = (surface: string, step: string) => ({ surface, step, context: 'manual', syncing: false });

  const openings: Array<{ name: string; screen?: 'account' | 'project'; expected: object }> = [
    { name: 'no screen opens the summary', expected: manualView('auth', 'summary') },
    { name: 'the project screen opens the project picker', screen: 'project', expected: manualView('auth', 'pick-project') },
    { name: 'the account screen opens the account picker', screen: 'account', expected: manualView('auth', 'pick-account') },
  ];

  openings.forEach(({ name, screen, expected }) => {
    test(`opening the auth view: ${name}`, async () => {
      await prepare(manualOptions);
      harness.service.openAuth(screen);
      assert.deepStrictEqual(view(), expected);
    });

    test(`closing a manual step returns to the monitor: ${name}`, async () => {
      await prepare(manualOptions);
      harness.service.openAuth(screen);
      await harness.service.closeAuth();
      assert.deepStrictEqual(view(), monitor);
    });
  });

  test('opening the auth view while the feature is inactive does nothing', async () => {
    harness = createHarness({ signInEnabled: false });
    published = [];
    harness.service.onDidChange((snapshot) => published.push(snapshot));
    await harness.service.start();
    harness.service.openAuth('project');
    assert.deepStrictEqual(
      { current: harness.service.current, published: published.length },
      { current: { ...INACTIVE_SNAPSHOT }, published: 0 }
    );
  });

  test('a manual project pick keeps the picker when the project list refreshes', async () => {
    await prepare(manualOptions);
    harness.service.openAuth('project');
    harness.transport.notify(signedIn);
    await flushPromises();
    assert.deepStrictEqual(view(), manualView('auth', 'pick-project'));
  });

  const linkings: Array<{ name: string; projectId: string | null; link: () => unknown; expected: unknown }> = [
    { name: 'a project', projectId: '102', link: () => ({ project: projects[1] }), expected: projects[1] },
    { name: 'reset to automatic', projectId: null, link: () => ({ project, source: 'remote' }), expected: project },
  ];

  linkings.forEach(({ name, projectId, link, expected }) => {
    test(`linking ${name} during a manual project pick returns to the monitor`, async () => {
      await prepare({ ...manualOptions, link: () => ({ project: null }) });
      harness.transport.respond('cs-ide/project-link-set', link).respond('cs-ide/project-link-get', link);
      harness.service.openAuth('project');
      const before = view();
      await harness.service.linkProject(projectId);
      assert.deepStrictEqual(
        { before, after: view(), linked: harness.service.current.linkedProject },
        { before: manualView('auth', 'pick-project'), after: monitor, linked: expected }
      );
    });
  });

  test('choosing a local account during a manual account pick returns to the monitor', async () => {
    await prepare(manualOptions);
    harness.transport.respond('cs-ide/auth-select-account', () => switched);
    harness.service.openAuth('account');
    const before = view();
    await harness.service.selectAccount('7');
    await flushPromises();
    assert.deepStrictEqual(
      { before, after: view(), account: harness.service.current.status?.account },
      { before: manualView('auth', 'pick-account'), after: monitor, account: switched.account }
    );
  });

  test('choosing an account that needs a browser login returns to the monitor once signed in', async () => {
    await prepare(manualOptions);
    harness.transport.respond('cs-ide/auth-select-account', () => authStatusFixture('signing-in'));
    harness.service.openAuth('account');
    await harness.service.selectAccount('7');
    const during = view();
    harness.transport.notify(switched);
    await flushPromises();
    assert.deepStrictEqual(
      { during, after: view(), opened: harness.opened.length },
      { during: manualView('auth', 'summary'), after: monitor, opened: 1 }
    );
  });

  const signInOpenings: Array<{ name: string; screen?: 'account' | 'project' }> = [
    { name: 'no screen' },
    { name: 'the project screen', screen: 'project' },
    { name: 'the account screen', screen: 'account' },
  ];

  signInOpenings.forEach(({ name, screen }) => {
    test(`opening the auth view with ${name} during a sign-in keeps the sign-in flow`, async () => {
      await prepare({ link: () => ({ project, source: 'remote' }) });
      await harness.service.signIn();
      harness.service.openAuth(screen);
      const during = view();
      harness.transport.notify(signedIn);
      await flushPromises();
      assert.deepStrictEqual(
        { during, after: view(), trail: trail() },
        {
          during: { surface: 'auth', step: 'summary', context: 'sign-in', syncing: true },
          after: monitor,
          trail: ['summary', 'resolving', 'summary'],
        }
      );
    });
  });

  test('turning the feature off while the login request is pending cancels that login', async () => {
    let release: (login: unknown) => void = () => undefined;
    await prepare();
    harness.transport
      .respond('cs-ide/auth-login', () => new Promise((resolve) => (release = resolve)))
      .respond('cs-ide/auth-cancel-login', () => authStatusFixture('signed-out'));
    const signingIn = harness.service.signIn();
    harness.settings.update({ signInEnabled: false });
    await flushPromises();
    release({ 'login-id': 'abc', 'authorize-url': 'https://codescene.io/oauth2/auth' });
    await signingIn;
    assert.deepStrictEqual(
      { opened: harness.opened, last: harness.transport.requests.at(-1) },
      { opened: [], last: { method: 'cs-ide/auth-cancel-login', params: { 'login-id': 'abc' } } }
    );
  });

  test('a second sign-in cancels the first pending login by its id', async () => {
    const releases: Array<(login: unknown) => void> = [];
    await prepare();
    harness.transport
      .respond('cs-ide/auth-login', () => new Promise((resolve) => releases.push(resolve)))
      .respond('cs-ide/auth-cancel-login', () => authStatusFixture('signed-out'));
    const first = harness.service.signIn();
    const second = harness.service.signIn();
    await flushPromises();
    releases[0]({ 'login-id': 'first', 'authorize-url': 'https://codescene.io/first' });
    releases[1]({ 'login-id': 'second', 'authorize-url': 'https://codescene.io/second' });
    await Promise.all([first, second]);
    assert.deepStrictEqual(
      {
        opened: harness.opened,
        cancelled: harness.transport.requests.filter((request) => request.method === 'cs-ide/auth-cancel-login'),
      },
      {
        opened: ['https://codescene.io/second'],
        cancelled: [{ method: 'cs-ide/auth-cancel-login', params: { 'login-id': 'first' } }],
      }
    );
  });

  test('finishing a manual flow does not cancel the login of a pending account choice', async () => {
    let release: (status: AuthStatus) => void = () => undefined;
    await prepare(manualOptions);
    harness.transport
      .respond('cs-ide/auth-select-account', () => new Promise((resolve) => (release = resolve)))
      .respond('cs-ide/project-link-set', () => ({ project }))
      .respond('cs-ide/auth-cancel-login', () => authStatusFixture('signed-out'));
    harness.service.openAuth('project');
    const selecting = harness.service.selectAccount('7');
    await harness.service.linkProject(project.id);
    release(authStatusFixture('signing-in'));
    await selecting;
    await flushPromises();
    assert.deepStrictEqual(
      {
        opened: harness.opened.length,
        cancelled: harness.transport.requests.some((request) => request.method === 'cs-ide/auth-cancel-login'),
      },
      { opened: 1, cancelled: false }
    );
  });
});

suite('AuthService flow payload', () => {
  const active: AuthSnapshot = {
    ...INACTIVE_SNAPSHOT,
    active: true,
    status: authStatusFixture('signed-in-oauth'),
    projectSource: 'remote',
    step: 'pick-project',
    context: 'sign-in',
    syncing: true,
  };
  const cases: Array<{ name: string; snapshot: AuthSnapshot; expected: unknown }> = [
    { name: 'inactive', snapshot: INACTIVE_SNAPSHOT, expected: undefined },
    {
      name: 'active',
      snapshot: active,
      expected: { step: 'pick-project', context: 'sign-in', 'project-source': 'remote', syncing: true },
    },
  ];

  cases.forEach(({ name, snapshot, expected }) => {
    test(`maps the ${name} snapshot to the auth flow`, () => {
      assert.deepStrictEqual(toAuthFlow(snapshot), expected);
    });
  });
});
