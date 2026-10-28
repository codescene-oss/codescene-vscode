import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  NOT_SIGNED_IN_MESSAGE,
  registerAuthCommands,
  SIGN_IN_COMMAND,
  SIGN_IN_INACTIVE_MESSAGE,
  SIGN_OUT_COMMAND,
  TOKEN_SIGN_OUT_MESSAGE,
} from '../../auth/auth-commands';
import { INACTIVE_SNAPSHOT, type AuthSnapshot } from '../../auth/auth-payload';
import type { AuthStatus } from '../../centralized-webview-framework/types/auth';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';

suite('auth commands', () => {
  const handlers = new Map<string, () => unknown>();
  const infos: string[] = [];
  const originalRegister = vscode.commands.registerCommand;
  const originalInfo = vscode.window.showInformationMessage;

  setup(() => {
    (vscode.commands as any).registerCommand = (id: string, handler: () => unknown) => {
      handlers.set(id, handler);
      return { dispose: () => {} };
    };
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infos.push(message);
      return undefined;
    };
  });

  teardown(() => {
    (vscode.commands as any).registerCommand = originalRegister;
    (vscode.window as any).showInformationMessage = originalInfo;
    handlers.clear();
    infos.length = 0;
  });

  function register(snapshot: AuthSnapshot) {
    const calls: string[] = [];
    const service = {
      current: snapshot,
      signIn: async () => {
        calls.push('signIn');
      },
      signOut: async () => {
        calls.push('signOut');
      },
    };
    registerAuthCommands(service, () => calls.push('showAuthView'));
    return calls;
  }

  async function run(id: string) {
    await handlers.get(id)!();
  }

  const active = (status: AuthStatus): AuthSnapshot => ({ ...INACTIVE_SNAPSHOT, active: true, status });

  test('every command explains the toggle while sign-in is inactive', async () => {
    const calls = register(INACTIVE_SNAPSHOT);
    await run(SIGN_IN_COMMAND);
    await run(SIGN_OUT_COMMAND);
    await run('codescene.openAccount');
    assert.deepStrictEqual(
      { calls, infos },
      { calls: [], infos: [SIGN_IN_INACTIVE_MESSAGE, SIGN_IN_INACTIVE_MESSAGE, SIGN_IN_INACTIVE_MESSAGE] }
    );
  });

  test('sign-in shows the account view and starts a browser sign-in', async () => {
    const calls = register(active(authStatusFixture('signed-out')));
    await run(SIGN_IN_COMMAND);
    assert.deepStrictEqual(calls, ['showAuthView', 'signIn']);
  });

  test('sign-in only shows the account view when already signed in', async () => {
    const calls = register(active(authStatusFixture('signed-in-oauth')));
    await run(SIGN_IN_COMMAND);
    assert.deepStrictEqual(calls, ['showAuthView']);
  });

  test('sign-out signs out an OAuth session', async () => {
    const calls = register(active(authStatusFixture('signed-in-oauth')));
    await run(SIGN_OUT_COMMAND);
    assert.deepStrictEqual(calls, ['signOut']);
  });

  test('sign-out explains how to remove a settings token', async () => {
    const calls = register(active(authStatusFixture('signed-in-setting-token-onprem')));
    await run(SIGN_OUT_COMMAND);
    assert.deepStrictEqual({ calls, infos }, { calls: [], infos: [TOKEN_SIGN_OUT_MESSAGE] });
  });

  test('sign-out says when nobody is signed in', async () => {
    register(active(authStatusFixture('signed-out')));
    await run(SIGN_OUT_COMMAND);
    assert.deepStrictEqual(infos, [NOT_SIGNED_IN_MESSAGE]);
  });

  test('open account shows the account view', async () => {
    const calls = register(active(authStatusFixture('signed-out')));
    await run('codescene.openAccount');
    assert.deepStrictEqual(calls, ['showAuthView']);
  });
});
