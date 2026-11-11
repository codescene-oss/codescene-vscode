import * as assert from 'assert';
import * as vscode from 'vscode';
import { CsRefactoringCommands } from '../../refactoring/commands';
import { RefactoringRequest } from '../../refactoring/request';
import { fnToRefactorForWholeFile } from '../../refactoring/fn-to-refactor';
import { TestTextDocument } from '../mocks/test-text-document';
import { FixGoalTarget } from '../../refactoring/agent-types';
import { aceSuite } from '../ace-test-suite';
import { resetExecutedCommands } from '../mocks/vscode';
import { resetWebviewPanelMocks } from '../setup';
import { RefactorResponse } from '../../devtools-api/refactor-models';
import * as csExtensionState from '../../cs-extension-state';
import { DevtoolsAPI } from '../../devtools-api';

const goal: FixGoalTarget = {
  goalId: 2,
  metricId: 'code-health',
  operator: 'greater-than-or-equal',
  target: 8.0,
  baseline: 6.2,
  repoRoot: '/repo',
  path: 'src/file.ts',
};

let document: TestTextDocument;
const edits: Array<{ uri: vscode.Uri; range: vscode.Range; newText: string }> = [];
const warnings: string[] = [];
const executed: string[] = [];

function goalRequest(original: string, responseCode: string): RefactoringRequest {
  const request = new RefactoringRequest(fnToRefactorForWholeFile(document), document, false, goal);
  const response: RefactorResponse = {
    code: responseCode,
    confidence: { level: 2, title: '', 'recommended-action': { description: '', details: '' } },
    reasons: [],
    'refactoring-properties': { 'removed-code-smells': [], 'added-code-smells': [] },
    metadata: {},
    'trace-id': 'trace-1',
    'goal-outcome': 'improved',
  };
  (request as any)._promise = Promise.resolve(response);
  return request;
}

function editTexts(): string[] {
  return edits.map((e) => e.newText);
}

aceSuite('Fix goal commands Test Suite', () => {
  let commands: CsRefactoringCommands;
  let originalApplyEdit: typeof vscode.workspace.applyEdit;
  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  let originalShowTextDocument: typeof vscode.window.showTextDocument;

  setup(() => {
    document = new TestTextDocument('/repo/src/file.ts', 'a\r\nb\r\n', 'typescript');
    edits.length = 0;
    warnings.length = 0;
    executed.length = 0;
    resetExecutedCommands();
    resetWebviewPanelMocks();

    DevtoolsAPI.enableAce();

    const mockUri = { fsPath: '/repo', scheme: 'file', authority: '', path: '/repo', query: '', fragment: '' };
    (csExtensionState.CsExtensionState as any)._instance = {
      extensionUri: mockUri,
      stateProperties: {
        auth: { active: false, status: null },
        features: {
          analysis: { state: 'enabled' },
          ace: { state: 'enabled' }
        }
      }
    };

    Object.defineProperty(csExtensionState.CsExtensionState, 'acknowledgedAceUsage', {
      get: () => true,
      configurable: true
    });

    commands = new CsRefactoringCommands();

    originalApplyEdit = vscode.workspace.applyEdit;
    originalShowWarningMessage = vscode.window.showWarningMessage;
    originalExecuteCommand = vscode.commands.executeCommand;
    originalShowTextDocument = vscode.window.showTextDocument;

    (vscode.workspace as any).applyEdit = async (edit: vscode.WorkspaceEdit) => {
      for (const entry of (edit as any)._edits) {
        edits.push({ uri: entry.uri, range: entry.range, newText: entry.newText });
      }
      return true;
    };

    (vscode.window as any).showWarningMessage = async (message: string) => {
      warnings.push(message);
      return undefined;
    };

    (vscode.window as any).showTextDocument = async (uri: vscode.Uri | vscode.TextDocument) => {
      return undefined;
    };

    (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
      executed.push(command);
      return originalExecuteCommand(command, ...args);
    };
  });

  teardown(() => {
    commands.dispose();
    (vscode.workspace as any).applyEdit = originalApplyEdit;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.window as any).showTextDocument = originalShowTextDocument;
    (vscode.commands as any).executeCommand = originalExecuteCommand;
  });

  test('apply replaces the whole document and does not reformat a goal fix', async () => {
    await (commands as any).applyRefactoringCmd(goalRequest('a\r\nb\r\n', 'c\r\n'));
    assert.deepStrictEqual({ edits: editTexts(), formatted: executed.includes('editor.action.formatSelection') }, { edits: ['c\r\n'], formatted: false });
  });

  test('apply refuses a goal fix when the document no longer matches', async () => {
    const request = goalRequest('a\n', 'c\n');
    document.setText('a\nmine\n');
    await (commands as any).applyRefactoringCmd(request);
    assert.deepStrictEqual({ edits: editTexts().length, warned: warnings.length }, { edits: 0, warned: 1 });
  });
});
