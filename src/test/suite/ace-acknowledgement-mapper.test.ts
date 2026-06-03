import * as assert from 'assert';
import * as configModule from '../../configuration';
import * as csExtensionState from '../../cs-extension-state';
import { getAutoRefactorConfig } from '../../codescene-tab/webview/ace/acknowledgement/ace-acknowledgement-mapper';

suite('AceAcknowledgementMapper Test Suite', () => {
  let originalGetAuthToken: typeof configModule.getAuthToken;

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
    Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', {
      get: () => ({
        features: { ace: { state: 'enabled' } },
      }),
      configurable: true,
    });
  });

  teardown(() => {
    (configModule as any).getAuthToken = originalGetAuthToken;
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
        features: { ace: { state: 'disabled' } },
      }),
      configurable: true,
    });
    assert.strictEqual(getAutoRefactorConfig().visible, false);
  });
});
