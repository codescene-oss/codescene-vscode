import * as assert from 'assert';
import * as vscode from 'vscode';
import { AuthPanel } from '../../auth/auth-panel';
import { setCwfAuth } from '../../auth/cwf-auth';
import { CsExtensionState } from '../../cs-extension-state';
import { flushPromises } from '../fakes/fake-auth-transport';
import { authPayloadFixture } from '../fixtures/auth/auth-fixtures';
import {
  getLastWebviewPanelMock,
  getWebviewMessageHandler,
  getWebviewPostMessageCalls,
  resetWebviewPanelMocks,
} from '../setup';

suite('AuthPanel', () => {
  const forwarded: unknown[] = [];
  const show = () =>
    AuthPanel.show(async (message) => {
      forwarded.push(message);
    });
  const viewProps = (auth: unknown) => ({
    ideType: 'VSCode',
    view: 'auth',
    devmode: false,
    pro: true,
    featureFlags: ['jobs', 'open-settings', 'ide-auth'],
    auth,
  });

  const originalInstance = (CsExtensionState as any)._instance;

  suiteTeardown(() => {
    (CsExtensionState as any)._instance = originalInstance;
  });

  setup(() => {
    (CsExtensionState as any)._instance = { extensionUri: vscode.Uri.file('/ext') };
    resetWebviewPanelMocks();
    forwarded.length = 0;
    setCwfAuth(authPayloadFixture('auth-payload-account-pick'));
  });

  teardown(() => {
    getLastWebviewPanelMock()?.dispose();
    setCwfAuth(undefined);
  });

  test('renders the auth view with the ide-auth flag', () => {
    show();
    const html = getLastWebviewPanelMock()!.webview.html;
    assert.ok(html.includes('"view":"auth"') && html.includes('"ide-auth"'), html);
  });

  test('pushes the latest payload after init and on each change', async () => {
    show();
    await getWebviewMessageHandler()!({ messageType: 'init', payload: 'auth' });
    setCwfAuth(authPayloadFixture('auth-payload-linked-project'));
    await flushPromises();
    assert.deepStrictEqual(getWebviewPostMessageCalls(), [
      { messageType: 'update-renderer', payload: viewProps(authPayloadFixture('auth-payload-account-pick')) },
      { messageType: 'update-renderer', payload: viewProps(authPayloadFixture('auth-payload-linked-project')) },
    ]);
  });

  test('forwards other messages to the auth message handler', async () => {
    show();
    await getWebviewMessageHandler()!({ messageType: 'auth-sign-in' });
    assert.deepStrictEqual(forwarded, [{ messageType: 'auth-sign-in' }]);
  });

  test('reveals the open panel instead of opening a second one', () => {
    show();
    const first = getLastWebviewPanelMock();
    show();
    assert.strictEqual(getLastWebviewPanelMock(), first);
    assert.strictEqual(first!.visible, true);
  });

  test('closes when browser sign-in turns inactive', () => {
    show();
    const first = getLastWebviewPanelMock();
    setCwfAuth(undefined);
    setCwfAuth(authPayloadFixture('auth-payload-account-pick'));
    show();
    assert.notStrictEqual(getLastWebviewPanelMock(), first);
  });
});
