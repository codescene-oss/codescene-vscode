import * as assert from 'assert';
import { signInFailed, signInOutcome, reauthorizeFailed } from '../../auth/auth-telemetry';
import type { AuthStatus } from '../../centralized-webview-framework/types/auth';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';

suite('signInOutcome', () => {
  const cancelled: AuthStatus = {
    ...authStatusFixture('signed-out'),
    error: { code: 'auth/cancelled', message: 'Sign-in was cancelled.' },
  };

  const cases: Array<{ name: string; previous: AuthStatus | null; next: AuthStatus; expected: unknown }> = [
    { name: 'no previous status', previous: null, next: authStatusFixture('signed-in-oauth'), expected: undefined },
    {
      name: 'a change that did not start from signing-in',
      previous: authStatusFixture('signed-out'),
      next: authStatusFixture('signed-in-oauth'),
      expected: undefined,
    },
    {
      name: 'still signing in',
      previous: authStatusFixture('signing-in'),
      next: authStatusFixture('signing-in'),
      expected: undefined,
    },
    {
      name: 'completion',
      previous: authStatusFixture('signing-in'),
      next: authStatusFixture('signed-in-oauth'),
      expected: { name: 'auth/sign-in-completed' },
    },
    {
      name: 'cancellation',
      previous: authStatusFixture('signing-in'),
      next: cancelled,
      expected: { name: 'auth/sign-in-cancelled' },
    },
    {
      name: 'timeout',
      previous: authStatusFixture('signing-in'),
      next: authStatusFixture('signed-out-timeout'),
      expected: { name: 'auth/sign-in-failed', data: { 'error-code': 'auth/timeout' } },
    },
    {
      name: 'sign-out without an error code',
      previous: authStatusFixture('signing-in'),
      next: authStatusFixture('signed-out'),
      expected: { name: 'auth/sign-in-failed', data: { 'error-code': 'unknown' } },
    },
  ];

  for (const { name, previous, next, expected } of cases) {
    test(`reports ${name}`, () => {
      assert.deepStrictEqual(signInOutcome(previous, next), expected);
    });
  }
});

suite('every auth event name matches the C3 catalogue', () => {
  const c3AuthNames = [
    'auth/sign-in-started',
    'auth/sign-in-completed',
    'auth/sign-in-cancelled',
    'auth/sign-in-failed',
    'auth/reauthorize-failed',
    'auth/reauthorize-started',
    'auth/sign-out',
    'auth/pat-set',
    'auth/pat-removed',
  ];

  const producedNames = [
    signInOutcome(authStatusFixture('signing-in'), authStatusFixture('signed-in-oauth'))?.name,
    signInOutcome(authStatusFixture('signing-in'), {
      ...authStatusFixture('signed-out'),
      error: { code: 'auth/cancelled', message: 'Sign-in was cancelled.' },
    })?.name,
    signInFailed('auth/timeout').name,
    signInFailed(undefined).name,
    reauthorizeFailed('auth/timeout').name,
    reauthorizeFailed(undefined).name,
  ];

  const directLogUsageNames = [
    'auth/sign-in-started',
    'auth/reauthorize-started',
    'auth/sign-out',
    'auth/pat-set',
    'auth/pat-removed',
  ];

  test('every produced name is in the C3 catalogue', () => {
    for (const name of producedNames) {
      if (name !== undefined) {
        assert.ok(c3AuthNames.includes(name), `Produced name ${name} not in C3 catalogue`);
      }
    }
  });

  test('every direct logUsage name is in the C3 catalogue', () => {
    for (const name of directLogUsageNames) {
      assert.ok(c3AuthNames.includes(name), `Direct logUsage name ${name} not in C3 catalogue`);
    }
  });

  test('signInFailed produces auth/sign-in-failed', () => {
    assert.strictEqual(signInFailed('auth/timeout').name, 'auth/sign-in-failed');
    assert.strictEqual(signInFailed(undefined).name, 'auth/sign-in-failed');
  });

  test('reauthorizeFailed produces auth/reauthorize-failed', () => {
    assert.strictEqual(reauthorizeFailed('auth/timeout').name, 'auth/reauthorize-failed');
    assert.strictEqual(reauthorizeFailed(undefined).name, 'auth/reauthorize-failed');
  });

  test('signInOutcome produces the correct auth names', () => {
    assert.strictEqual(
      signInOutcome(authStatusFixture('signing-in'), authStatusFixture('signed-in-oauth'))?.name,
      'auth/sign-in-completed'
    );
    assert.strictEqual(
      signInOutcome(authStatusFixture('signing-in'), {
        ...authStatusFixture('signed-out'),
        error: { code: 'auth/cancelled', message: 'Sign-in was cancelled.' },
      })?.name,
      'auth/sign-in-cancelled'
    );
    assert.strictEqual(
      signInOutcome(authStatusFixture('signing-in'), authStatusFixture('signed-out-timeout'))?.name,
      'auth/sign-in-failed'
    );
  });
});
