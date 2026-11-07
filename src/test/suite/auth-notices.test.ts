import * as assert from 'assert';
import { AuthNotices } from '../../auth/auth-notices';
import { INACTIVE_SNAPSHOT, type AuthSnapshot } from '../../auth/auth-payload';
import type { AuthStatus } from '../../centralized-webview-framework/types/auth';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';
import { createHarness } from '../fakes/auth-service-harness';
import { flushPromises } from '../fakes/fake-auth-transport';

const ACTIVATION_MESSAGE = 'CodeScene requires a CodeScene account. Sign in to get Code Health analysis in your editor.';

function active(status: AuthStatus | null): AuthSnapshot {
  return { ...INACTIVE_SNAPSHOT, active: true, status };
}

function unlicensedStatus(): AuthStatus {
  return authStatusFixture('signed-out');
}

function resolvingStatus(): AuthStatus {
  return { ...authStatusFixture('signed-in-oauth'), license: null };
}

interface NoticeHarnessResult {
  notices: AuthNotices;
  shown: Array<{ message: string; items: string[] }>;
  calls: string[];
  telemetry: Array<{ name: string; data?: Record<string, unknown> }>;
}

function noticeHarness(choice: string | undefined): NoticeHarnessResult {
  const shown: Array<{ message: string; items: string[] }> = [];
  const calls: string[] = [];
  const telemetry: Array<{ name: string; data?: Record<string, unknown> }> = [];
  const notices = new AuthNotices({
    show: async (message: string, ...items: string[]) => {
      shown.push({ message, items });
      return choice;
    },
    signIn: async () => calls.push('signIn'),
    focusHomeView: async () => calls.push('focusHomeView'),
    logUsage: (name: string, data?: Record<string, unknown>) => telemetry.push({ name, data }),
  });
  return { notices, shown, calls, telemetry };
}

suite('AuthNotices', () => {
  test('shows-activation-notice-once', async () => {
    const { notices, shown } = noticeHarness(undefined);
    await notices.update(active(unlicensedStatus()));
    await notices.update(active(unlicensedStatus()));
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].message, ACTIVATION_MESSAGE);
    assert.deepStrictEqual(shown[0].items, ['Sign in', 'Use access token']);
  });

  test('no-notice-while-resolving', async () => {
    const { notices, shown } = noticeHarness(undefined);
    await notices.update(active(resolvingStatus()));
    assert.deepStrictEqual(shown, []);
  });

  test('sign-in-action-starts-sign-in', async () => {
    const { notices, calls } = noticeHarness('Sign in');
    await notices.update(active(unlicensedStatus()));
    assert.deepStrictEqual(calls, ['signIn']);
  });

  test('use-access-token-action-focuses-home-view', async () => {
    const { notices, calls } = noticeHarness('Use access token');
    await notices.update(active(unlicensedStatus()));
    assert.deepStrictEqual(calls, ['focusHomeView']);
  });

  test('gate-shown-once-per-session', async () => {
    const harness = createHarness();
    const shown: Array<{ message: string; items: string[] }> = [];
    const telemetry: Array<{ name: string; data?: Record<string, unknown> }> = [];
    const notices = new AuthNotices({
      show: async (message: string, ...items: string[]) => {
        shown.push({ message, items });
        return undefined;
      },
      signIn: async () => undefined,
      focusHomeView: async () => undefined,
      logUsage: (name: string, data?: Record<string, unknown>) => telemetry.push({ name, data }),
    });

    harness.service.onDidChange((snapshot) => void notices.update(snapshot));
    await harness.service.start();
    await flushPromises();

    harness.transport.notify(unlicensedStatus());
    await flushPromises();

    harness.transport.notify(authStatusFixture('signed-in-oauth'));
    await flushPromises();

    harness.transport.emitRestart();
    await flushPromises();

    harness.transport.notify(unlicensedStatus());
    await flushPromises();

    assert.strictEqual(shown.length, 1, 'should show notification only once');
    assert.strictEqual(shown[0].message, ACTIVATION_MESSAGE);
    assert.strictEqual(telemetry.length, 1, 'should log telemetry only once');
    assert.strictEqual(telemetry[0].name, 'auth/gate-shown');
  });
});
