import * as assert from 'assert';
import * as os from 'os';
import * as vscode from 'vscode';
import { REAUTHORIZE_CONTEXT_KEY } from '../../auth/auth-commands';
import { activateAuth, revealOnAuthRequest } from '../../auth/auth-feature';
import type { AuthSnapshot } from '../../auth/auth-payload';
import { FakeAuthTransport, flushPromises } from '../fakes/fake-auth-transport';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';
import { setCwfAuth } from '../../auth/cwf-auth';
import { CsExtensionState } from '../../cs-extension-state';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { restoreDefaultConfiguration } from '../setup';

const FOCUS_COMMAND = 'codescene.homeView.focus';

suite('Auth feature reveal', () => {
  const executed: string[] = [];
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  let requests: vscode.EventEmitter<void>;

  setup(() => {
    requests = new vscode.EventEmitter<void>();
    executed.length = 0;
    originalExecuteCommand = vscode.commands.executeCommand;
    vscode.commands.executeCommand = ((command: string) => {
      executed.push(command);
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;
  });

  teardown(() => {
    vscode.commands.executeCommand = originalExecuteCommand;
    requests.dispose();
  });

  const focuses = () => executed.filter((command) => command === FOCUS_COMMAND).length;

  test('focuses the sidebar on every auth request', () => {
    const subscription = revealOnAuthRequest({ onDidRequestAuth: requests.event });
    requests.fire();
    requests.fire();
    subscription.dispose();
    assert.strictEqual(focuses(), 2);
  });

  test('stops focusing once disposed', () => {
    revealOnAuthRequest({ onDidRequestAuth: requests.event }).dispose();
    requests.fire();
    assert.strictEqual(focuses(), 0);
  });
});

suite('Auth feature activation', () => {
  const contextKeys: Array<[string, unknown]> = [];
  const updates: Array<Pick<AuthSnapshot, 'active' | 'status'>> = [];
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  let disposables: vscode.Disposable[] = [];
  let context: vscode.ExtensionContext;

  setup(() => {
    context = createMockExtensionContext(os.tmpdir());
    CsExtensionState.init(context);
    contextKeys.length = 0;
    updates.length = 0;
    originalExecuteCommand = vscode.commands.executeCommand;
    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      if (command === 'setContext') contextKeys.push([args[0] as string, args[1]]);
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue?: unknown) => (key === 'experimental.signIn' ? true : defaultValue),
      has: () => true,
      inspect: () => ({}),
      update: () => Promise.resolve(),
    });
  });

  teardown(() => {
    disposables.forEach((disposable) => disposable.dispose());
    disposables = [];
    setCwfAuth(undefined);
    vscode.commands.executeCommand = originalExecuteCommand;
    restoreDefaultConfiguration();
  });

  test('publishes the reauthorize context key and forwards each snapshot to objectives', async () => {
    const transport = new FakeAuthTransport()
      .respond('cs-ide/auth-configure', () => authStatusFixture('signed-out'))
      .respond('cs-ide/auth-list-accounts', () => [])
      .respond('cs-ide/projects-list', () => [])
      .respond('cs-ide/project-link-get', () => ({ project: null }))
      .respond('cs-ide/auth-sync-account', () => {
        throw Object.assign(new Error('Method not found'), { code: -32601 });
      });
    const objectives = {
      disposables: [],
      update: (snapshot: Pick<AuthSnapshot, 'active' | 'status'>) => updates.push(snapshot),
      startWorkSession: () => Promise.resolve(),
      fixGoal: () => Promise.resolve(),
    };
    disposables = activateAuth(context, transport, objectives);
    await flushPromises();
    transport.notify({ ...authStatusFixture('signed-in-oauth'), 'reauthorize-needed': true });
    await flushPromises();
    assert.deepStrictEqual(
      {
        reauthorizeKey: contextKeys.filter(([key]) => key === REAUTHORIZE_CONTEXT_KEY).at(-1),
        lastUpdate: updates.at(-1)?.status?.['reauthorize-needed'],
      },
      { reauthorizeKey: [REAUTHORIZE_CONTEXT_KEY, true], lastUpdate: true }
    );
  });
});
