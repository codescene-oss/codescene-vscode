import * as assert from 'assert';
import { isAceAvailable, refactorToken, resolveAceToken, type AceAuthState } from '../../auth/ace-credential';
import { MissingAuthTokenError } from '../../missing-auth-token-error';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';

const INACTIVE: AceAuthState = { active: false, status: null };
const SIGNED_IN_CLOUD: AceAuthState = { active: true, status: authStatusFixture('signed-in-oauth') };
const SIGNED_IN_ONPREM_PAT: AceAuthState = { active: true, status: authStatusFixture('signed-in-setting-token-onprem') };

suite('isAceAvailable', () => {
  const cases: Array<{ name: string; token: string | undefined; auth: AceAuthState; expected: boolean }> = [
    { name: 'a token with sign-in inactive', token: 'cloud-ace-1', auth: INACTIVE, expected: true },
    { name: 'no token with sign-in inactive', token: undefined, auth: INACTIVE, expected: false },
    {
      name: 'no token while toggled off, even if a status says ace-credential',
      token: undefined,
      auth: { active: false, status: authStatusFixture('signed-in-oauth') },
      expected: false,
    },
    { name: 'no token, signed in with an ACE credential', token: undefined, auth: SIGNED_IN_CLOUD, expected: true },
    { name: 'no token, signed in without an ACE credential', token: undefined, auth: SIGNED_IN_ONPREM_PAT, expected: true },
    { name: 'no token, signing in', token: undefined, auth: { active: true, status: authStatusFixture('signing-in') }, expected: false },
    { name: 'no token, signed out', token: undefined, auth: { active: true, status: authStatusFixture('signed-out') }, expected: false },
    { name: 'a token while signed out', token: 'cloud-ace-1', auth: { active: true, status: authStatusFixture('signed-out') }, expected: true },
  ];

  for (const { name, token, auth, expected } of cases) {
    test(`${name}: ${expected}`, () => {
      assert.strictEqual(isAceAvailable(token, auth), expected);
    });
  }
});

suite('refactorToken', () => {
  test('sends the token whenever one exists, even when cs-ide has a credential', () => {
    assert.strictEqual(refactorToken('cloud-ace-1', SIGNED_IN_CLOUD), 'cloud-ace-1');
  });

  test('sends no token when cs-ide attaches its ACE credential', () => {
    assert.strictEqual(refactorToken(undefined, SIGNED_IN_CLOUD), undefined);
  });

  test('throws when ACE is unavailable', () => {
    assert.throws(() => refactorToken(undefined, INACTIVE), MissingAuthTokenError);
  });
});

suite('resolveAceToken', () => {
  const cases = [
    { name: 'uses the setting token', setting: 'cloud-ace-1', legacy: 'legacy-1', expected: 'cloud-ace-1' },
    { name: 'falls back to the legacy session token', setting: undefined, legacy: 'legacy-1', expected: 'legacy-1' },
    { name: 'skips a blank setting token', setting: '  ', legacy: 'legacy-1', expected: 'legacy-1' },
    { name: 'trims the token', setting: ' cloud-ace-1 ', legacy: undefined, expected: 'cloud-ace-1' },
    { name: 'has no token without either', setting: '', legacy: undefined, expected: undefined },
  ];

  for (const { name, setting, legacy, expected } of cases) {
    test(name, () => {
      assert.strictEqual(resolveAceToken(setting, legacy), expected);
    });
  }
});
