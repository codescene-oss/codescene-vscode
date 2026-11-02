import * as assert from 'assert';
import * as vscode from 'vscode';
import { publishAuth } from '../../auth/auth-feature';
import type { AuthSurface } from '../../auth/auth-flow';
import { AuthNotices } from '../../auth/auth-notices';
import { INACTIVE_SNAPSHOT, type AuthSnapshot } from '../../auth/auth-payload';
import { setCwfAuth } from '../../auth/cwf-auth';
import { CsExtensionState } from '../../cs-extension-state';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';
import { createMockExtensionContext } from '../mocks/mock-extension-context';

const FOCUS_COMMAND = 'codescene.homeView.focus';

suite('Auth feature publishing', () => {
  const executed: string[] = [];
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  let notices: AuthNotices;

  const signedIn = (surface: AuthSurface): AuthSnapshot => ({
    ...INACTIVE_SNAPSHOT,
    active: true,
    status: authStatusFixture('signed-in-oauth'),
    surface,
  });
  const inactive = (surface: AuthSurface): AuthSnapshot => ({ ...INACTIVE_SNAPSHOT, surface });

  setup(() => {
    const context = createMockExtensionContext('/auth-feature');
    if (!CsExtensionState.hasInstance) CsExtensionState.init(context);
    notices = new AuthNotices(context.globalState, { show: async () => undefined, signIn: async () => undefined });
    executed.length = 0;
    originalExecuteCommand = vscode.commands.executeCommand;
    vscode.commands.executeCommand = ((command: string) => {
      executed.push(command);
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;
  });

  teardown(() => {
    vscode.commands.executeCommand = originalExecuteCommand;
    setCwfAuth(undefined);
  });

  const cases: Array<{ name: string; snapshots: AuthSnapshot[]; focuses: number }> = [
    { name: 'focuses the sidebar when the surface changes to auth', snapshots: [signedIn('monitor'), signedIn('auth')], focuses: 1 },
    { name: 'does not refocus on repeated auth publishes', snapshots: [signedIn('auth'), signedIn('auth'), signedIn('auth')], focuses: 1 },
    { name: 'does not focus when returning to the monitor', snapshots: [signedIn('monitor'), signedIn('monitor')], focuses: 0 },
    {
      name: 'focuses again on each new transition to auth',
      snapshots: [signedIn('auth'), signedIn('monitor'), signedIn('auth')],
      focuses: 2,
    },
    { name: 'does not focus while browser sign-in is inactive', snapshots: [inactive('auth')], focuses: 0 },
  ];

  for (const { name, snapshots, focuses } of cases) {
    test(name, () => {
      for (const snapshot of snapshots) publishAuth(snapshot, notices);
      assert.strictEqual(executed.filter((command) => command === FOCUS_COMMAND).length, focuses);
    });
  }
});
