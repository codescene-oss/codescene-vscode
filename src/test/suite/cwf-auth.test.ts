import * as assert from 'assert';
import { onDidChangeCwfAuth, setCwfAuth, withCwfAuth } from '../../auth/cwf-auth';
import type { HomeContextViewProps } from '../../centralized-webview-framework/types';
import { authPayloadFixture } from '../fixtures/auth/auth-fixtures';

suite('withCwfAuth', () => {
  const homeProps = (): HomeContextViewProps => ({
    ideType: 'VSCode',
    view: 'home',
    featureFlags: ['jobs'],
    data: { fileDeltaData: [] },
  });

  teardown(() => setCwfAuth(undefined));

  test('passes props through unchanged while sign-in is inactive', () => {
    const props = homeProps();
    assert.strictEqual(withCwfAuth(props), props);
  });

  test('adds the ide-auth flag and the auth payload while sign-in is active', () => {
    const payload = authPayloadFixture('auth-payload-linked-project');
    setCwfAuth(payload);
    assert.deepStrictEqual(withCwfAuth(homeProps()), {
      ideType: 'VSCode',
      view: 'home',
      featureFlags: ['jobs', 'ide-auth'],
      data: { fileDeltaData: [] },
      auth: payload,
    });
  });

  test('notifies listeners on every change', () => {
    let calls = 0;
    const subscription = onDidChangeCwfAuth(() => calls++);
    setCwfAuth(authPayloadFixture('auth-payload-account-pick'));
    setCwfAuth(undefined);
    subscription.dispose();
    assert.strictEqual(calls, 2);
  });
});
