import * as assert from 'assert';
import { AuthNotices, DONT_SHOW_AGAIN, shouldNudge } from '../../auth/auth-notices';
import { INACTIVE_SNAPSHOT, type AuthSnapshot } from '../../auth/auth-payload';
import type { AuthStatus } from '../../centralized-webview-framework/types/auth';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';

const SIGN_IN_TEXT = 'Sign in to CodeScene in your browser to connect the extension to your account.';
const settingTokenRejected: AuthStatus = {
  ...authStatusFixture('signed-out'),
  'oauth-supported': true,
  error: { code: 'auth/invalid-token', message: 'The access token was rejected by CodeScene.' },
};

function active(status: AuthStatus): AuthSnapshot {
  return { ...INACTIVE_SNAPSHOT, active: true, status };
}

function memento() {
  const values = new Map<string, unknown>();
  return {
    values,
    get: (key: string): any => values.get(key),
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
}

function noticeHarness(choice: string | undefined, state = memento()) {
  const shown: string[] = [];
  const calls: string[] = [];
  const notices = new AuthNotices(state, {
    show: async (message: string) => {
      shown.push(message);
      return choice;
    },
    signIn: async () => calls.push('signIn'),
  });
  return { notices, shown, calls, state };
}

suite('shouldNudge', () => {
  const cases: Array<{ name: string; snapshot: AuthSnapshot; expected: boolean }> = [
    { name: 'inactive sign-in', snapshot: INACTIVE_SNAPSHOT, expected: false },
    { name: 'signed out', snapshot: active(authStatusFixture('signed-out')), expected: true },
    { name: 'signed out after cs-ide skipped a rejected setting token', snapshot: active(settingTokenRejected), expected: true },
    { name: 'an env token', snapshot: active(authStatusFixture('signed-out-env-token-invalid')), expected: false },
    { name: 'a server without OAuth', snapshot: active(authStatusFixture('signed-out-oauth-unsupported')), expected: false },
    { name: 'a previous sign-in error', snapshot: active(authStatusFixture('signed-out-timeout')), expected: false },
    { name: 'signed in', snapshot: active(authStatusFixture('signed-in-oauth')), expected: false },
    {
      name: 'signed in with a rejected setting token',
      snapshot: active(authStatusFixture('signed-in-oauth-setting-token-rejected')),
      expected: false,
    },
  ];

  for (const { name, snapshot, expected } of cases) {
    test(`nudges for ${name}: ${expected}`, () => {
      assert.strictEqual(shouldNudge(snapshot), expected);
    });
  }
});

suite('AuthNotices', () => {
  test('shows the sign-in nudge once per session', async () => {
    const { notices, shown } = noticeHarness(undefined);
    await notices.update(active(authStatusFixture('signed-out')));
    await notices.update(active(authStatusFixture('signed-out')));
    assert.deepStrictEqual(shown, [SIGN_IN_TEXT]);
  });

  test("persists Don't show again across sessions", async () => {
    const first = noticeHarness(DONT_SHOW_AGAIN);
    await first.notices.update(active(authStatusFixture('signed-out')));
    const second = noticeHarness(undefined, first.state);
    await second.notices.update(active(authStatusFixture('signed-out')));
    assert.deepStrictEqual(
      { stored: first.state.values.get('codescene.auth.signInNudgeDismissed'), shownAgain: second.shown },
      { stored: true, shownAgain: [] }
    );
  });

  test('Sign in starts the sign-in command', async () => {
    const { notices, calls } = noticeHarness('Sign in');
    await notices.update(active(authStatusFixture('signed-out')));
    assert.deepStrictEqual(calls, ['signIn']);
  });
});
