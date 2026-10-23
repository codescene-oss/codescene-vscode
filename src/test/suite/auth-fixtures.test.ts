import * as assert from 'assert';
import type { AuthContextViewProps } from '../../centralized-webview-framework/types';
import { AUTH_STATUS_FIXTURES, authPayloadFixture, authStatusFixture } from '../fixtures/auth/auth-fixtures';

const AUTH_STATUS_KEYS = [
  'account',
  'ace-credential',
  'credential-source',
  'env-token-present',
  'error',
  'expires-at',
  'license',
  'login',
  'oauth-supported',
  'server',
  'state',
  'user',
];

suite('auth contract fixtures', () => {
  for (const name of AUTH_STATUS_FIXTURES) {
    test(`${name} carries every AuthStatus key`, () => {
      assert.deepStrictEqual(Object.keys(authStatusFixture(name)).sort(), AUTH_STATUS_KEYS);
    });
  }

  test('every server carries the PAT page URL', () => {
    assert.deepStrictEqual(
      AUTH_STATUS_FIXTURES.filter((name) => !authStatusFixture(name).server['pat-url']),
      [],
    );
  });

  test('auth view props accept the ide-auth flag and a payload fixture', () => {
    const props: AuthContextViewProps = {
      ideType: 'VSCode',
      view: 'auth',
      featureFlags: ['ide-auth'],
      auth: authPayloadFixture('auth-payload-linked-project'),
    };
    assert.deepStrictEqual(props.auth?.['linked-project'], { id: '101', name: 'acme-backend' });
  });
});
