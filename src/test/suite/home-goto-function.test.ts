import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { BackgroundServiceView } from '../../code-health-monitor/background-view';
import { handleCWFMessage } from '../../code-health-monitor/home/cwf-message-handlers';
import { HomeView } from '../../code-health-monitor/home/home-view';
import { FileWithIssues } from '../../code-health-monitor/file-with-issues';
import type { FunctionInfoExternal } from '../../centralized-webview-framework/types/delta';
import { CsExtensionState } from '../../cs-extension-state';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { TestTextDocument } from '../mocks/test-text-document';

const repo = path.join('/repo');
const monitored = path.join(repo, 'src', 'monitored.ts');
const goalFile = path.join(repo, 'src', 'goal.ts');

const range = (line: number) => new vscode.Range(new vscode.Position(line, 2), new vscode.Position(line + 3, 1));

const symbols = [
  { name: 'Outer', range: range(0), selectionRange: range(0), children: [{ name: 'inner', range: range(4), selectionRange: range(4), children: [] }] },
  { name: 'top', range: range(10), selectionRange: range(10), children: [] },
];

const symbolInformation = [{ name: 'legacy', location: { uri: vscode.Uri.file(goalFile), range: range(20) } }];

suite('Home view go to function Test Suite', () => {
  const window = vscode.window as any;
  const workspace = vscode.workspace as any;
  const originals = {
    showTextDocument: window.showTextDocument,
    openTextDocument: workspace.openTextDocument,
    executeCommand: vscode.commands.executeCommand,
  };

  let homeView: HomeView;
  let shown: Array<{ fileName: string; position?: vscode.Position }>;
  let opened: string[];
  let providedSymbols: unknown[] | undefined;

  setup(() => {
    const context = createMockExtensionContext(repo);
    CsExtensionState.init(context);
    homeView = new HomeView(context, { updateBadge: () => {}, dispose: () => {} } as unknown as BackgroundServiceView);
    shown = [];
    opened = [];
    providedSymbols = symbols;

    window.showTextDocument = async (document: vscode.TextDocument) => {
      const entry: { fileName: string; position?: vscode.Position } = { fileName: document.fileName, position: undefined };
      shown.push(entry);
      return {
        set selection(selection: vscode.Selection) {
          entry.position = selection.active;
        },
        revealRange: () => {},
      };
    };
    workspace.openTextDocument = async (uri: vscode.Uri) => {
      opened.push(uri.fsPath);
      if (uri.fsPath.endsWith('missing.ts')) throw new Error('ENOENT');
      return new TestTextDocument(uri.fsPath, 'class Outer {}\n', 'typescript');
    };
    vscode.commands.executeCommand = (async (command: string) =>
      command === 'vscode.executeDocumentSymbolProvider' ? providedSymbols : undefined) as typeof vscode.commands.executeCommand;
  });

  teardown(() => {
    window.showTextDocument = originals.showTextDocument;
    workspace.openTextDocument = originals.openTextDocument;
    vscode.commands.executeCommand = originals.executeCommand;
    homeView.dispose();
  });

  const goTo = (fileName: string, fn?: FunctionInfoExternal) =>
    handleCWFMessage(homeView, { messageType: 'goto-function-location', payload: { fileName, fn } });

  test('a Monitor file with a range opens its tracked document at the range', async () => {
    const document = new TestTextDocument(monitored, '', 'typescript');
    homeView.getFileIssueMap().set(monitored, new FileWithIssues({ 'file-level-findings': [], 'function-level-findings': [] } as any, document));
    await goTo(monitored, { name: 'top', range: { startLine: 3, startColumn: 5, endLine: 9, endColumn: 2 } });
    assert.deepStrictEqual({ shown, opened }, { shown: [{ fileName: monitored, position: new vscode.Position(2, 4) }], opened: [] });
  });

  const cases = [
    { name: 'a file the Monitor does not track is opened at the top', fn: undefined, position: undefined },
    { name: 'a function found by name is opened at its name', fn: { name: 'top' }, position: new vscode.Position(10, 2) },
    { name: 'a nested function found by name is opened at its name', fn: { name: 'inner' }, position: new vscode.Position(4, 2) },
    { name: 'a function not found by name opens the file at the top', fn: { name: 'gone' }, position: undefined },
  ];
  for (const { name, fn, position } of cases) {
    test(name, async () => {
      await goTo(goalFile, fn);
      assert.deepStrictEqual({ shown, opened }, { shown: [{ fileName: goalFile, position }], opened: [goalFile] });
    });
  }

  test('a function found by name in flat symbol information is opened at its range', async () => {
    providedSymbols = symbolInformation;
    await goTo(goalFile, { name: 'legacy' });
    assert.deepStrictEqual(shown, [{ fileName: goalFile, position: new vscode.Position(20, 2) }]);
  });

  test('a file without a symbol provider opens at the top', async () => {
    providedSymbols = undefined;
    await goTo(goalFile, { name: 'top' });
    assert.deepStrictEqual(shown, [{ fileName: goalFile, position: undefined }]);
  });

  test('a file that cannot be opened shows nothing', async () => {
    await goTo(path.join(repo, 'src', 'missing.ts'), { name: 'top' });
    assert.deepStrictEqual(shown, []);
  });
});
