import { aceSuite } from '../ace-test-suite';
import * as assert from 'assert';
import * as configModule from '../../configuration';
import * as csExtensionState from '../../cs-extension-state';
import type { AuthStatus } from '../../centralized-webview-framework/types/auth';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';
import { getAutoRefactorConfig } from '../../codescene-tab/webview/ace/acknowledgement/ace-acknowledgement-mapper';

aceSuite('AceAcknowledgementMapper Test Suite', () => {
  let originalGetAuthToken: typeof configModule.getAuthToken;
  let originalStateProperties: PropertyDescriptor | undefined;

  function mockToken(token: string) {
    (configModule as any).getAuthToken = () => token;
  }

  function mockAcknowledged(acknowledged: boolean | undefined) {
    Object.defineProperty(csExtensionState.CsExtensionState, 'acknowledgedAceUsage', {
      get: () => acknowledged,
      configurable: true,
    });
  }

  setup(() => {
    originalGetAuthToken = configModule.getAuthToken;
    originalStateProperties = Object.getOwnPropertyDescriptor(csExtensionState.CsExtensionState, 'stateProperties');
    Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', {
      get: () => ({
        auth: { active: false, status: null },
        features: { ace: { state: 'enabled' } },
      }),
      configurable: true,
    });
  });

  teardown(() => {
    (configModule as any).getAuthToken = originalGetAuthToken;
    if (originalStateProperties) {
      Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', originalStateProperties);
    }
  });

  test('activated true when acknowledged and token present', () => {
    mockToken('secret');
    mockAcknowledged(true);
    assert.strictEqual(getAutoRefactorConfig().activated, true);
  });

  test('activated true when acknowledged and no token', () => {
    mockToken('');
    mockAcknowledged(true);
    assert.strictEqual(getAutoRefactorConfig().activated, true);
  });

  test('activated false when unacknowledged and token present', () => {
    mockToken('secret');
    mockAcknowledged(false);
    assert.strictEqual(getAutoRefactorConfig().activated, false);
  });

  test('activated true when unacknowledged and no token', () => {
    mockToken('');
    mockAcknowledged(false);
    assert.strictEqual(getAutoRefactorConfig().activated, true);
  });

  test('disabled is true when token not configured', () => {
    mockToken('');
    mockAcknowledged(false);
    assert.strictEqual(getAutoRefactorConfig().disabled, true);
  });

  test('disabled is false when token configured', () => {
    mockToken('secret');
    mockAcknowledged(false);
    assert.strictEqual(getAutoRefactorConfig().disabled, false);
  });

  test('visible follows ace feature state', () => {
    mockToken('secret');
    mockAcknowledged(true);
    Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', {
      get: () => ({
        auth: { active: false, status: null },
        features: { ace: { state: 'disabled' } },
      }),
      configurable: true,
    });
    assert.strictEqual(getAutoRefactorConfig().visible, false);
  });

  test('disabled is false when only a legacy session token exists', () => {
    mockToken('');
    mockAcknowledged(true);
    Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', {
      get: () => ({
        auth: { active: false, status: null },
        legacySession: { accessToken: 'legacy-1', userId: undefined },
        features: { ace: { state: 'enabled' } },
      }),
      configurable: true,
    });
    assert.strictEqual(getAutoRefactorConfig().disabled, false);
  });

  test('disabled follows the signed-in ACE credential when no token exists', () => {
    mockToken('');
    mockAcknowledged(true);
    const disabledWith = (status: AuthStatus) => {
      Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', {
        get: () => ({ auth: { active: true, status }, features: { ace: { state: 'enabled' } } }),
        configurable: true,
      });
      return getAutoRefactorConfig().disabled;
    };
    assert.deepStrictEqual(
      {
        cloud: disabledWith(authStatusFixture('signed-in-oauth')),
        onpremPat: disabledWith(authStatusFixture('signed-in-setting-token-onprem')),
      },
      { cloud: false, onpremPat: true }
    );
  });
});
