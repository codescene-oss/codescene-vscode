import * as assert from 'assert';
import * as vscode from 'vscode';
import { CsStatusBar } from '../../cs-statusbar';
import { AnalysisFeature, CsExtensionState } from '../../cs-extension-state';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';

type FakeItem = { text: string; tooltip: string; command: string; backgroundColor?: unknown };

suite('CsStatusBar automatic analysis', () => {
  let originalCreate: typeof vscode.window.createStatusBarItem;
  let originalStateProperties: PropertyDescriptor | undefined;
  let analysisFeature: AnalysisFeature;
  let items: FakeItem[];

  setup(() => {
    originalCreate = vscode.window.createStatusBarItem;
    originalStateProperties = Object.getOwnPropertyDescriptor(CsExtensionState, 'stateProperties');
    analysisFeature = { state: 'enabled' };
    Object.defineProperty(CsExtensionState, 'stateProperties', {
      configurable: true,
      get: () => ({
        features: {
          analysis: analysisFeature,
          ace: { state: 'enabled' },
        },
      }),
    });
    items = [];
    vscode.window.createStatusBarItem = (() => {
      const item = {
        text: '',
        tooltip: '',
        command: '',
        backgroundColor: undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined,
      };
      items.push(item);
      return item as any;
    }) as typeof vscode.window.createStatusBarItem;
  });

  teardown(() => {
    vscode.window.createStatusBarItem = originalCreate;
    restoreDefaultConfiguration();
    if (originalStateProperties) {
      Object.defineProperty(CsExtensionState, 'stateProperties', originalStateProperties);
    }
  });

  function renderAnalysisItem(): FakeItem {
    const bar = new CsStatusBar();
    bar.update();
    bar.dispose();
    return items[items.length - 1];
  }

  test('shows a stopped state that starts analysis on click', () => {
    mockConfiguration('codescene', { enableAutomaticAnalysis: false });
    const analysis = renderAnalysisItem();
    assert.strictEqual(analysis.text, '$(debug-pause) Analysis stopped');
    assert.strictEqual(analysis.command, 'codescene.startAutomaticAnalysis');
  });

  const analysisStateCases: Array<{ name: string; feature: AnalysisFeature; expected: Partial<FakeItem> }> = [
    {
      name: 'ready once enabled even if no review has run yet',
      feature: { state: 'enabled' },
      expected: { text: '$(cs-logo) Analysis', command: 'codescene.homeView.focus' },
    },
    {
      name: 'ready when the runner reports idle',
      feature: { state: 'enabled', analysisState: 'idle' },
      expected: { text: '$(cs-logo) Analysis', command: 'codescene.homeView.focus' },
    },
    {
      name: 'ready when the runner reports idle while still loading',
      feature: { state: 'loading', analysisState: 'idle' },
      expected: { text: '$(cs-logo) Analysis', command: 'codescene.homeView.focus' },
    },
    {
      name: 'initializing while the analysis feature is loading',
      feature: { state: 'loading' },
      expected: { text: '$(loading~spin) Initializing...', command: 'codescene.showLogOutput' },
    },
    {
      name: 'analyzing with the queue count while the runner is busy',
      feature: { state: 'enabled', analysisState: 'running', queueCount: 2 },
      expected: {
        text: '$(loading~spin) Analyzing...',
        tooltip: 'CodeScene analysis in progress (2 remaining)...',
        command: 'codescene.showLogOutput',
      },
    },
  ];

  analysisStateCases.forEach(({ name, feature, expected }) => {
    test(`shows ${name}`, () => {
      analysisFeature = feature;
      const analysis = renderAnalysisItem();
      for (const [key, value] of Object.entries(expected)) {
        assert.strictEqual(analysis[key as keyof FakeItem], value, key);
      }
    });
  });
});
