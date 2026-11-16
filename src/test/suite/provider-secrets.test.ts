import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  getAgentProviderOptions,
  initProviderSecrets,
  migrateProviderApiKeysFromSettings,
  promptForProviderApiKey,
  storeProviderApiKey,
} from '../../refactoring/provider-secrets';
import { MockSecretStorage } from '../mocks/mock-secret-storage';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';

suite('provider secrets', () => {
  let secrets: MockSecretStorage;
  const window = vscode.window as any;
  const originals = { showQuickPick: window.showQuickPick, showInputBox: window.showInputBox };

  setup(() => {
    secrets = new MockSecretStorage();
    initProviderSecrets(secrets);
  });

  teardown(() => {
    restoreDefaultConfiguration();
    window.showQuickPick = originals.showQuickPick;
    window.showInputBox = originals.showInputBox;
  });

  test('stored keys join the Bedrock settings', async () => {
    mockConfiguration('codescene', { providerOptions: { 'amazon-bedrock:region': 'eu-west-1' } });
    await secrets.store('codescene.agent.anthropic:api-key', 'sk-ant');
    assert.deepStrictEqual(await getAgentProviderOptions(), {
      'amazon-bedrock:region': 'eu-west-1',
      'anthropic:api-key': 'sk-ant',
    });
  });

  test('a stored key wins over a key left in settings', async () => {
    mockConfiguration('codescene', { providerOptions: { 'openai:api-key': 'from-settings' } });
    await secrets.store('codescene.agent.openai:api-key', 'from-secrets');
    assert.deepStrictEqual(await getAgentProviderOptions(), { 'openai:api-key': 'from-secrets' });
  });

  const storeCases = [
    { name: 'stores a trimmed key', value: ' sk-1 ', expected: 'sk-1' },
    { name: 'removes the key when blank', value: '  ', expected: undefined },
  ];

  for (const { name, value, expected } of storeCases) {
    test(`storeProviderApiKey ${name}`, async () => {
      await secrets.store('codescene.agent.google:api-key', 'old');
      await storeProviderApiKey('google:api-key', value);
      assert.strictEqual(secrets.values.get('codescene.agent.google:api-key'), expected);
    });
  }

  function stubProviderOptions(globalValue?: Record<string, string>, workspaceValue?: Record<string, string>) {
    const updates: Array<{ value: unknown; target: unknown }> = [];
    (vscode.workspace as any).getConfiguration = () => ({
      get: () => undefined,
      has: () => true,
      inspect: () => ({ globalValue, workspaceValue }),
      update: (key: string, value: unknown, target: unknown) => {
        updates.push({ value, target });
        return Promise.resolve();
      },
    });
    return updates;
  }

  test('migration moves keys out of user and workspace settings', async () => {
    const updates = stubProviderOptions(
      { 'anthropic:api-key': 'user-key', 'amazon-bedrock:profile': 'dev' },
      { 'anthropic:api-key': 'workspace-key', 'openai:api-key': 'sk-openai' }
    );

    const moved = await migrateProviderApiKeysFromSettings();

    assert.deepStrictEqual(
      { moved, secrets: Object.fromEntries(secrets.values), updates },
      {
        moved: 3,
        secrets: { 'codescene.agent.anthropic:api-key': 'workspace-key', 'codescene.agent.openai:api-key': 'sk-openai' },
        updates: [
          { value: undefined, target: vscode.ConfigurationTarget.Workspace },
          { value: { 'amazon-bedrock:profile': 'dev' }, target: vscode.ConfigurationTarget.Global },
        ],
      }
    );
  });

  test('migration leaves settings without keys alone', async () => {
    const updates = stubProviderOptions({ 'amazon-bedrock:profile': 'dev' }, undefined);
    assert.deepStrictEqual({ moved: await migrateProviderApiKeysFromSettings(), updates }, { moved: 0, updates: [] });
  });

  test('the command stores the key for the picked provider', async () => {
    let pickedFrom: any[] = [];
    let inputOptions: any;
    window.showQuickPick = async (items: any[]) => {
      pickedFrom = items;
      return items.find((item) => item.option === 'openai:api-key');
    };
    window.showInputBox = async (options: any) => {
      inputOptions = options;
      return 'sk-new';
    };
    await secrets.store('codescene.agent.anthropic:api-key', 'sk-ant');

    await promptForProviderApiKey();

    assert.deepStrictEqual(
      {
        labels: pickedFrom.map((item) => `${item.label}${item.description ? ` (${item.description})` : ''}`),
        password: inputOptions.password,
        stored: secrets.values.get('codescene.agent.openai:api-key'),
      },
      { labels: ['Anthropic (Key stored)', 'OpenAI', 'Google (Gemini)'], password: true, stored: 'sk-new' }
    );
  });

  test('the command changes nothing when the input is cancelled', async () => {
    window.showQuickPick = async (items: any[]) => items[0];
    window.showInputBox = async () => undefined;
    await secrets.store('codescene.agent.anthropic:api-key', 'sk-ant');

    await promptForProviderApiKey();

    assert.strictEqual(secrets.values.get('codescene.agent.anthropic:api-key'), 'sk-ant');
  });
});
