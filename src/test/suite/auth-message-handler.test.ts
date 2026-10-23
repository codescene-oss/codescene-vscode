import * as assert from 'assert';
import {
  handleAuthMessage,
  registerAuthMessages,
  routeAuthMessage,
  type AuthActions,
  type AuthMessage,
  type AuthMessageTarget,
} from '../../auth/auth-message-handler';
import { INACTIVE_SNAPSHOT } from '../../auth/auth-payload';
import type { AuthStatus } from '../../centralized-webview-framework/types/auth';
import { authRpcError } from '../fakes/fake-auth-transport';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';
import { assertLogContains, assertLogOmits } from '../setup';

function recorder(status: AuthStatus | null = authStatusFixture('signed-in-setting-token-onprem')) {
  const calls: unknown[][] = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, ...args]);
  };
  const actions: AuthActions = {
    current: { ...INACTIVE_SNAPSHOT, active: status !== null, status },
    signIn: record('signIn'),
    openBrowserAgain: record('openBrowserAgain'),
    cancelSignIn: record('cancelSignIn'),
    signOut: record('signOut'),
    retry: record('retry'),
    selectAccount: record('selectAccount'),
    linkProject: record('linkProject'),
    setAccessToken: record('setAccessToken'),
    removeAccessToken: record('removeAccessToken'),
  };
  const target: AuthMessageTarget = {
    showAuthView: () => {
      calls.push(['showAuthView']);
    },
    openServerSetting: record('openServerSetting'),
    openExternal: record('openExternal'),
  };
  return { calls, actions, target };
}

suite('handleAuthMessage', () => {
  const cases: Array<{ message: AuthMessage; expected: unknown[] }> = [
    { message: { messageType: 'open-auth' }, expected: ['showAuthView'] },
    { message: { messageType: 'auth-sign-in' }, expected: ['signIn'] },
    { message: { messageType: 'auth-open-browser-again' }, expected: ['openBrowserAgain'] },
    { message: { messageType: 'auth-cancel-sign-in' }, expected: ['cancelSignIn'] },
    { message: { messageType: 'auth-sign-out' }, expected: ['signOut'] },
    { message: { messageType: 'auth-retry' }, expected: ['retry'] },
    { message: { messageType: 'auth-select-account', payload: { accountId: '7' } }, expected: ['selectAccount', '7'] },
    { message: { messageType: 'auth-link-project', payload: { projectId: null } }, expected: ['linkProject', null] },
    { message: { messageType: 'auth-set-access-token', payload: { token: 'pat-1' } }, expected: ['setAccessToken', 'pat-1'] },
    { message: { messageType: 'auth-remove-access-token' }, expected: ['removeAccessToken'] },
    { message: { messageType: 'auth-open-server-setting' }, expected: ['openServerSetting'] },
    {
      message: { messageType: 'auth-open-pat-page' },
      expected: ['openExternal', 'https://codescene.acme.internal/configuration/user/token'],
    },
  ];

  for (const { message, expected } of cases) {
    test(`${message.messageType} calls ${String(expected[0])}`, async () => {
      const { calls, actions, target } = recorder();
      await handleAuthMessage(actions, target, message);
      assert.deepStrictEqual(calls, [expected]);
    });
  }
});

suite('auth-open-pat-page', () => {
  test('opens the Cloud PAT page reported by cs-ide', async () => {
    const { calls, actions, target } = recorder(authStatusFixture('signed-out'));
    await handleAuthMessage(actions, target, { messageType: 'auth-open-pat-page' });
    assert.deepStrictEqual(calls, [['openExternal', 'https://codescene.io/users/me/pat']]);
  });

  test('opens nothing before cs-ide has reported a status', async () => {
    const { calls, actions, target } = recorder(null);
    await handleAuthMessage(actions, target, { messageType: 'auth-open-pat-page' });
    assert.deepStrictEqual(calls, []);
  });
});

suite('routeAuthMessage', () => {
  test('leaves messages unhandled before registration', async () => {
    assert.strictEqual(await routeAuthMessage({ messageType: 'auth-sign-in' }), false);
  });

  test('leaves non-auth messages to the view', async () => {
    const { actions, target } = recorder();
    const registration = registerAuthMessages(actions, target);
    try {
      assert.strictEqual(await routeAuthMessage({ messageType: 'open-settings' }), false);
    } finally {
      registration.dispose();
    }
  });

  test('handles auth messages and logs failures without the payload', async () => {
    const { actions, target } = recorder();
    actions.setAccessToken = async () => {
      throw authRpcError('auth/network');
    };
    const registration = registerAuthMessages(actions, target);
    try {
      const handled = await routeAuthMessage({ messageType: 'auth-set-access-token', payload: { token: 'secret-pat-123' } });
      assert.strictEqual(handled, true);
      assertLogContains('warn', '[auth] auth-set-access-token failed code=auth/network');
      assertLogOmits('secret-pat-123');
    } finally {
      registration.dispose();
    }
  });
});
