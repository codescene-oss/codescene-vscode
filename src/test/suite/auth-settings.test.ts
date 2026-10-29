import * as assert from 'assert';
import * as vscode from 'vscode';
import { authConfiguration, readAuthSettings, writeAccessToken } from '../../auth/auth-settings';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';

suite('authConfiguration', () => {
  const cases = [
    {
      name: 'blank values become null',
      settings: { signInEnabled: true, serverUrl: '  ', accessToken: '' },
      expected: { 'server-url': null, 'access-token': null },
    },
    {
      name: 'values are trimmed',
      settings: { signInEnabled: true, serverUrl: ' https://cs.example ', accessToken: ' pat-1 ' },
      expected: { 'server-url': 'https://cs.example', 'access-token': 'pat-1' },
    },
  ];

  for (const { name, settings, expected } of cases) {
    test(name, () => {
      assert.deepStrictEqual(authConfiguration(settings), expected);
    });
  }
});

suite('readAuthSettings', () => {
  teardown(() => restoreDefaultConfiguration());

  test('reads the toggle, server URL and token', () => {
    mockConfiguration('codescene', { 'experimental.signIn': true, serverUrl: 'https://cs.example', authToken: 'pat-1' });
    assert.deepStrictEqual(readAuthSettings(), { signInEnabled: true, serverUrl: 'https://cs.example', accessToken: 'pat-1' });
  });

  test('defaults to sign-in off and empty strings', () => {
    mockConfiguration('codescene', {});
    assert.deepStrictEqual(readAuthSettings(), { signInEnabled: false, serverUrl: '', accessToken: '' });
  });
});

suite('writeAccessToken', () => {
  const updates: Array<{ key: string; value: unknown; target: unknown }> = [];

  function stubConfig(workspaceValue?: string) {
    updates.length = 0;
    (vscode.workspace as any).getConfiguration = () => ({
      get: () => undefined,
      has: () => true,
      inspect: () => ({ workspaceValue }),
      update: (key: string, value: unknown, target: unknown) => {
        updates.push({ key, value, target });
        return Promise.resolve();
      },
    });
  }

  teardown(() => restoreDefaultConfiguration());

  const cases = [
    {
      name: 'stores a token in user settings',
      workspaceValue: undefined,
      token: ' pat-1 ',
      expected: [{ key: 'authToken', value: 'pat-1', target: vscode.ConfigurationTarget.Global }],
    },
    {
      name: 'stores a token where a workspace value already wins',
      workspaceValue: 'old',
      token: 'pat-1',
      expected: [{ key: 'authToken', value: 'pat-1', target: vscode.ConfigurationTarget.Workspace }],
    },
    {
      name: 'removes the token from workspace and user settings',
      workspaceValue: 'old',
      token: undefined,
      expected: [
        { key: 'authToken', value: undefined, target: vscode.ConfigurationTarget.Workspace },
        { key: 'authToken', value: undefined, target: vscode.ConfigurationTarget.Global },
      ],
    },
    {
      name: 'treats a blank token as removal',
      workspaceValue: undefined,
      token: '  ',
      expected: [{ key: 'authToken', value: undefined, target: vscode.ConfigurationTarget.Global }],
    },
  ];

  for (const { name, workspaceValue, token, expected } of cases) {
    test(name, async () => {
      stubConfig(workspaceValue);
      await writeAccessToken(token);
      assert.deepStrictEqual(updates, expected);
    });
  }
});
