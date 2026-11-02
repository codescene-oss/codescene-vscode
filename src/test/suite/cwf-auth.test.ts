import * as assert from 'assert';
import type { AuthFlow } from '../../centralized-webview-framework/types/auth';
import { cwfAuthSurface, onDidChangeCwfAuth, setCwfAuth, withCwfAuth } from '../../auth/cwf-auth';
import type { HomeContextViewProps } from '../../centralized-webview-framework/types';
import { authPayloadFixture } from '../fixtures/auth/auth-fixtures';

const flow: AuthFlow = { step: 'pick-project', context: 'sign-in', 'project-source': 'remote', syncing: false };

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

  test('adds the auth flow next to the payload', () => {
    const payload = authPayloadFixture('auth-payload-linked-project');
    setCwfAuth(payload, flow, 'auth');
    assert.deepStrictEqual(withCwfAuth(homeProps()), {
      ideType: 'VSCode',
      view: 'home',
      featureFlags: ['jobs', 'ide-auth'],
      data: { fileDeltaData: [] },
      auth: payload,
      authFlow: flow,
    });
  });

  test('adds neither auth nor authFlow while inactive', () => {
    setCwfAuth(undefined, flow, 'auth');
    const result = withCwfAuth(homeProps());
    assert.strictEqual('auth' in result, false);
    assert.strictEqual('authFlow' in result, false);
  });

  test('omits authFlow when no flow was published', () => {
    setCwfAuth(authPayloadFixture('auth-payload-linked-project'));
    assert.strictEqual('authFlow' in withCwfAuth(homeProps()), false);
  });

  test('cwfAuthSurface follows setCwfAuth and defaults to monitor', () => {
    assert.strictEqual(cwfAuthSurface(), 'monitor');
    setCwfAuth(authPayloadFixture('auth-payload-linked-project'), flow, 'auth');
    assert.strictEqual(cwfAuthSurface(), 'auth');
    setCwfAuth(authPayloadFixture('auth-payload-linked-project'), flow);
    assert.strictEqual(cwfAuthSurface(), 'monitor');
    setCwfAuth(undefined);
    assert.strictEqual(cwfAuthSurface(), 'monitor');
  });

  test('cwfAuthSurface stays on the monitor while browser sign-in is inactive', () => {
    setCwfAuth(undefined, flow, 'auth');
    assert.strictEqual(cwfAuthSurface(), 'monitor');
  });

  test('notifies listeners when only the surface or only the flow changes', () => {
    const payload = authPayloadFixture('auth-payload-linked-project');
    setCwfAuth(payload, flow, 'monitor');
    let calls = 0;
    const subscription = onDidChangeCwfAuth(() => calls++);
    setCwfAuth(payload, flow, 'auth');
    setCwfAuth(payload, { ...flow, syncing: true }, 'auth');
    subscription.dispose();
    assert.strictEqual(calls, 2);
  });
});
