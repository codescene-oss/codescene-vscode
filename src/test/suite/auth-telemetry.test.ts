import * as assert from 'assert';
import { signInOutcome } from '../../auth/auth-telemetry';
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
