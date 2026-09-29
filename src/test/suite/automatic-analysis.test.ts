import * as assert from 'assert';
import * as vscode from 'vscode';
import { automaticAnalysisEnabled, setAutomaticAnalysisEnabled } from '../../configuration';
import { getMessageCategory } from '../../code-health-monitor/home/cwf-message-categories';
import { handleCWFMessage } from '../../code-health-monitor/home/cwf-message-handlers';
import { restoreDefaultConfiguration } from '../setup';

suite('automatic analysis setting', () => {
  const updates: Array<{ key: string; value: unknown; target?: unknown }> = [];

  function stubConfig(inspect: { workspaceValue?: boolean } = {}) {
    updates.length = 0;
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue?: boolean) => {
        void key;
        return defaultValue;
      },
      has: () => true,
      inspect: () => inspect,
      update: (key: string, value: unknown, target?: unknown) => {
        updates.push({ key, value, target });
        return Promise.resolve();
      },
    });
  }

  teardown(() => {
    restoreDefaultConfiguration();
  });

  test('defaults to enabled', () => {
    stubConfig();
    assert.strictEqual(automaticAnalysisEnabled(), true);
  });

  test('writes the user setting and clears a workspace override', () => {
    stubConfig({ workspaceValue: false });
    setAutomaticAnalysisEnabled(true);
    assert.deepStrictEqual(updates, [
      { key: 'enableAutomaticAnalysis', value: undefined, target: vscode.ConfigurationTarget.Workspace },
      { key: 'enableAutomaticAnalysis', value: true, target: vscode.ConfigurationTarget.Global },
    ]);
  });

  test('stop-analysis and start-analysis write the setting', async () => {
    stubConfig();
    await handleCWFMessage({} as any, { messageType: 'stop-analysis' });
    await handleCWFMessage({} as any, { messageType: 'start-analysis' });
    assert.deepStrictEqual(
      updates.map((update) => update.value),
      [false, true]
    );
  });
});

suite('getMessageCategory analysis', () => {
  const cases = [
    { messageType: 'stop-analysis', expected: 'analysis' },
    { messageType: 'start-analysis', expected: 'analysis' },
  ];

  for (const { messageType, expected } of cases) {
    test(`${messageType} is categorized as ${expected}`, () => {
      assert.strictEqual(getMessageCategory(messageType), expected);
    });
  }
});
