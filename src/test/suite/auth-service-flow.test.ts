import * as assert from 'assert';
import { INACTIVE_SNAPSHOT, type AuthRepo, type AuthSnapshot } from '../../auth/auth-payload';
import type { Account, AuthStatus, Project } from '../../centralized-webview-framework/types/auth';
import { createHarness, type Harness } from '../fakes/auth-service-harness';
import { flushPromises } from '../fakes/fake-auth-transport';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';

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
    projects?: () => unknown;
    link?: (params: Record<string, unknown>) => unknown;
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
      .respond('cs-ide/projects-list', options.projects ?? (() => projects))
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

  const tokenStatus = authStatusFixture('signed-in-setting-token-onprem');

  const preparePersonalAccessToken = async (options: FlowOptions = {}): Promise<void> => {
    await prepare(options);
    harness.transport.respond('cs-ide/auth-configure', () =>
      harness.settings.read().accessToken ? tokenStatus : authStatusFixture('signed-out')
    );
  };

  test('setting an access token from the auth view resolves the project and returns to the monitor', async () => {
    await preparePersonalAccessToken({ link: () => ({ project, source: 'remote' }) });
    harness.service.openAuth();
    published = [];
    await harness.service.setAccessToken('pat');
    await flushPromises();
    assert.deepStrictEqual(
      { view: view(), trail: trail(), linkedProject: harness.service.current.linkedProject },
      { view: monitor, trail: ['summary', 'resolving', 'summary'], linkedProject: project }
    );
  });

  test('setting an access token that finds no project offers the project picker like a browser sign-in', async () => {
    await preparePersonalAccessToken();
    harness.service.openAuth();
    await harness.service.setAccessToken('pat');
    await flushPromises();
    assert.deepStrictEqual(view(), { surface: 'auth', step: 'pick-project', context: 'sign-in', syncing: false });
  });

  test('an access token written to the settings while the auth view is closed does not open it', async () => {
    await preparePersonalAccessToken({ link: () => ({ project, source: 'remote' }) });
    harness.settings.update({ accessToken: 'pat' });
    await flushPromises();
    assert.deepStrictEqual(view(), monitor);
  });

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

  test('hiding the sign-in banner is remembered for the session across sign-in changes and the toggle', async () => {
    await prepare();
    const hidden = () => harness.service.current.signInBannerHidden;
    const initial = hidden();
    harness.service.hideSignInBanner();
    const afterHide = hidden();
    harness.transport.notify(signedIn);
    await flushPromises();
    harness.transport.notify(authStatusFixture('signed-out'));
    await flushPromises();
    harness.settings.update({ signInEnabled: false });
    await flushPromises();
    harness.settings.update({ signInEnabled: true });
    await flushPromises();
    assert.deepStrictEqual(
      { initial, afterHide, afterChanges: hidden() },
      { initial: false, afterHide: true, afterChanges: true }
    );
  });

  test('hiding the sign-in banner does nothing while sign-in is off', async () => {
    await prepare();
    harness.settings.update({ signInEnabled: false });
    await flushPromises();
    harness.service.hideSignInBanner();
    assert.strictEqual(harness.service.current.signInBannerHidden, false);
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

  const otherRepo = { path: 'C:\\git\\other-web', name: 'other-web' };
  const otherProject = { id: '201', name: 'other-web' };
  const linkByRepo = (params: Record<string, unknown>) =>
    params['repo-path'] === otherRepo.path ? { project: otherProject, source: 'remote' } : { project: null };

  test('an account data load that finishes after a repo switch keeps the new repo link', async () => {
    let release: (value: unknown) => void = () => undefined;
    await prepare({
      configure: signedIn,
      repo: null,
      link: linkByRepo,
      projects: () => new Promise((resolve) => (release = resolve)),
    });
    await harness.service.setRepo(otherRepo);
    release(projects);
    await flushPromises();
    const { linkedProject, projectSource, projects: loaded } = harness.service.current;
    assert.deepStrictEqual(
      { linkedProject, projectSource, loaded },
      { linkedProject: otherProject, projectSource: 'remote', loaded: projects }
    );
  });

  test('a project link that finishes after a repo switch is not shown on the new repo', async () => {
    let release: (value: unknown) => void = () => undefined;
    await prepare({ configure: signedIn, link: linkByRepo });
    harness.transport.respond('cs-ide/project-link-set', () => new Promise((resolve) => (release = resolve)));
    const linking = harness.service.linkProject(project.id);
    await harness.service.setRepo(otherRepo);
    release({ project });
    await linking;
    const { repo: current, linkedProject, projectSource } = harness.service.current;
    assert.deepStrictEqual(
      { current, linkedProject, projectSource },
      { current: otherRepo, linkedProject: otherProject, projectSource: 'remote' }
    );
  });

  test('a repo switch while resolving does not offer the project picker before its link is found', async () => {
    let release: (value: unknown) => void = () => undefined;
    await prepare({
      link: (params) =>
        params['repo-path'] === otherRepo.path ? new Promise((resolve) => (release = resolve)) : { project: null },
    });
    await harness.service.signIn();
    harness.transport.notify(signedIn);
    const switching = harness.service.setRepo(otherRepo);
    await flushPromises();
    const during = view();
    release({ project: otherProject, source: 'remote' });
    await switching;
    await flushPromises();
    assert.deepStrictEqual(
      { during, after: view(), trail: trail(), linked: harness.service.current.linkedProject },
      {
        during: { surface: 'auth', step: 'resolving', context: 'sign-in', syncing: true },
        after: monitor,
        trail: ['summary', 'resolving', 'summary'],
        linked: otherProject,
      }
    );
  });

  test('reports syncing while the account data loads at startup', async () => {
    let release: (value: unknown) => void = () => undefined;
    await prepare({ configure: signedIn, projects: () => new Promise((resolve) => (release = resolve)) });
    const during = harness.service.current.syncing;
    release(projects);
    await flushPromises();
    assert.deepStrictEqual({ during, after: harness.service.current.syncing }, { during: true, after: false });
  });

  test('reports syncing while the account data reloads after an account switch', async () => {
    let release: (value: unknown) => void = () => undefined;
    await prepare({ configure: signedIn });
    harness.transport
      .respond('cs-ide/auth-select-account', () => switched)
      .respond('cs-ide/projects-list', () => new Promise((resolve) => (release = resolve)));
    const before = harness.service.current.syncing;
    await harness.service.selectAccount('7');
    const during = harness.service.current.syncing;
    release(projects);
    await flushPromises();
    assert.deepStrictEqual(
      { before, during, after: harness.service.current.syncing },
      { before: false, during: true, after: false }
    );
  });

  const accountBLocal: Account = { ...accountB, 'signed-in-locally': true };
  const manualOptions: FlowOptions = { configure: signedIn, accounts: [accountA, accountBLocal] };
  const manualView = (surface: string, step: string) => ({ surface, step, context: 'manual', syncing: false });

  const openings: Array<{ name: string; screen?: string; expected: object }> = [
    { name: 'no screen opens the summary', expected: manualView('auth', 'summary') },
    { name: 'the project screen opens the project picker', screen: 'project', expected: manualView('auth', 'pick-project') },
    { name: 'the account screen opens the account picker', screen: 'account', expected: manualView('auth', 'pick-account') },
    { name: 'an unknown screen opens the summary', screen: 'bogus', expected: manualView('auth', 'summary') },
    { name: 'an inherited property name opens the summary', screen: 'toString', expected: manualView('auth', 'summary') },
  ];

  openings.forEach(({ name, screen, expected }) => {
    test(`opening the auth view: ${name}`, async () => {
      await prepare(manualOptions);
      harness.service.openAuth(screen as 'account' | 'project');
      assert.deepStrictEqual(view(), expected);
    });

    test(`closing a manual step returns to the monitor: ${name}`, async () => {
      await prepare(manualOptions);
      harness.service.openAuth(screen as 'account' | 'project');
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

  const requests: Array<{ name: string; steps: Array<'open' | 'sign-in' | 'status'>; expected: number }> = [
    { name: 'opening the auth view', steps: ['open'], expected: 1 },
    { name: 'opening the auth view again while it is shown', steps: ['open', 'open'], expected: 2 },
    { name: 'starting a sign-in', steps: ['sign-in'], expected: 1 },
    { name: 'opening the auth view while a sign-in is running', steps: ['sign-in', 'open'], expected: 2 },
    { name: 'a status update while the auth view is shown', steps: ['open', 'status'], expected: 1 },
  ];

  requests.forEach(({ name, steps, expected }) => {
    test(`requests the auth view ${expected} time(s) for ${name}`, async () => {
      await prepare(manualOptions);
      let requested = 0;
      harness.service.onDidRequestAuth(() => requested++);
      for (const step of steps) {
        if (step === 'open') harness.service.openAuth();
        if (step === 'sign-in') await harness.service.signIn();
        if (step === 'status') harness.transport.notify(signedIn);
        await flushPromises();
      }
      assert.strictEqual(requested, expected);
    });
  });

  test('does not request the auth view while the feature is inactive', async () => {
    harness = createHarness({ signInEnabled: false });
    await harness.service.start();
    let requested = 0;
    harness.service.onDidRequestAuth(() => requested++);
    harness.service.openAuth();
    await harness.service.signIn();
    assert.strictEqual(requested, 0);
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
