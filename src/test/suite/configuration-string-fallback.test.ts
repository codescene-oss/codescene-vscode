import * as assert from 'assert';
import * as vscode from 'vscode';
import { getConfiguration } from '../../configuration';
import { restoreDefaultConfiguration } from '../setup';

suite('getConfiguration string fallback', () => {
  function stubConfig(effective: string | undefined, workspaceValue?: string, globalValue?: string) {
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue?: string) => (key ? effective ?? defaultValue : undefined),
      has: () => true,
      inspect: () => ({ workspaceValue, globalValue }),
      update: () => Promise.resolve(),
    });
  }

  teardown(() => restoreDefaultConfiguration());

  const cases = [
    { name: 'returns the trimmed effective value', effective: ' pat-1 ', workspace: undefined, global: 'user', expected: 'pat-1' },
    { name: 'skips a blank effective value for the workspace value', effective: '  ', workspace: ' ws ', global: 'user', expected: 'ws' },
    { name: 'uses the user value when workspace and effective are blank', effective: '', workspace: ' ', global: ' user ', expected: 'user' },
    { name: 'returns the default when every source is blank', effective: undefined, workspace: undefined, global: undefined, expected: '' },
  ];

  for (const { name, effective, workspace, global, expected } of cases) {
    test(name, () => {
      stubConfig(effective, workspace, global);
      assert.strictEqual(getConfiguration<string>('authToken', ''), expected);
    });
  }
});
