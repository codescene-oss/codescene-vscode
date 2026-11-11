import * as assert from 'assert';
import * as vscode from 'vscode';
import { CsRefactoringCommands } from '../../refactoring/commands';
import { RefactoringRequest } from '../../refactoring/request';
import { fnToRefactorForWholeFile } from '../../refactoring/fn-to-refactor';
import { TestTextDocument } from '../mocks/test-text-document';
import { FixGoalTarget } from '../../refactoring/agent-types';
import { aceSuite } from '../ace-test-suite';
import { getAppliedEdits, getWebviewMessageHandler, resetAppliedEdits, resetWebviewPanelMocks } from '../setup';
import { RefactorResponse } from '../../devtools-api/refactor-models';
import { CsExtensionState } from '../../cs-extension-state';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { CodeSceneCWFAceTabPanel } from '../../codescene-tab/webview/ace/cwf-webview-ace-panel';
import { CodeSceneCWFAceAcknowledgementTabPanel } from '../../codescene-tab/webview/ace/acknowledgement/cwf-webview-ace-acknowledgement-panel';
import { SAVE_AND_REFACTOR } from '../../refactoring/unsaved-changes';
import { flushPromises } from '../fakes/fake-auth-transport';

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
const warnings: string[] = [];
const executed: Array<{ command: string; args: unknown[] }> = [];
let warningAnswer: string | undefined;

function responseWith(code: string): RefactorResponse {
  return {
    code,
    confidence: { level: 2, title: '', 'recommended-action': { description: '', details: '' } },
    reasons: [],
    'refactoring-properties': { 'removed-code-smells': [], 'added-code-smells': [] },
    metadata: {},
    'trace-id': 'trace-1',
    'goal-outcome': 'improved',
  };
}

function requestWith(responseCode: string, requestGoal?: FixGoalTarget): RefactoringRequest {
  const request = new RefactoringRequest(fnToRefactorForWholeFile(document), document, false, requestGoal);
  (request as any)._promise = Promise.resolve(responseWith(responseCode));
  return request;
}

function goalRequest(original: string, responseCode: string): RefactoringRequest {
  document.setText(original);
  return requestWith(responseCode, goal);
}

function edits() {
  return getAppliedEdits().flatMap((edit) => edit.replacements);
}

function editTexts(): string[] {
  return edits().map((e) => e.newText);
}

function executedCommandNames(): string[] {
  return executed.map((e) => e.command);
}

function lastCommand() {
  return executed[executed.length - 1];
}

aceSuite('Fix goal commands Test Suite', () => {
  let commands: CsRefactoringCommands;
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  const originalExecuteCommand = vscode.commands.executeCommand;
  const originalPanelShow = CodeSceneCWFAceTabPanel.show;

  setup(async () => {
    document = new TestTextDocument('/repo/src/file.ts', 'a\r\nb\r\n', 'typescript');
    warnings.length = 0;
    executed.length = 0;
    warningAnswer = undefined;
    resetAppliedEdits();
    resetWebviewPanelMocks();

    CsExtensionState.init(createMockExtensionContext('/test/fix-goal-commands'));
    await CsExtensionState.setAcknowledgedAceUsage(true);

    commands = new CsRefactoringCommands();

    (vscode.window as any).showWarningMessage = async (message: string) => {
      warnings.push(message);
      return warningAnswer;
    };

    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      executed.push({ command, args });
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;
  });

  teardown(() => {
    commands.dispose();
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    vscode.commands.executeCommand = originalExecuteCommand;
    CodeSceneCWFAceTabPanel.show = originalPanelShow;
    resetAppliedEdits();
    resetWebviewPanelMocks();
  });

  test('apply replaces the whole document and does not reformat a goal fix', async () => {
    await (commands as any).applyRefactoringCmd(goalRequest('a\r\nb\r\n', 'c\r\n'));
    assert.deepStrictEqual(
      { edits: editTexts(), formatted: executedCommandNames().includes('editor.action.formatSelection') },
      { edits: ['c\r\n'], formatted: false }
    );
    assert.deepStrictEqual(
      edits()[0].range,
      new vscode.Range(document.positionAt(0), document.positionAt('a\r\nb\r\n'.length))
    );
  });

  test('apply refuses a goal fix when the document no longer matches', async () => {
    const request = goalRequest('a\n', 'c\n');
    document.setText('a\nmine\n');
    await (commands as any).applyRefactoringCmd(request);
    assert.deepStrictEqual({ edits: editTexts().length, warned: warnings.length }, { edits: 0, warned: 1 });
  });

  test('apply still formats a smell refactoring', async () => {
    await (commands as any).applyRefactoringCmd(requestWith('c\r\n'));
    assert.deepStrictEqual(
      { edits: editTexts(), formatted: executedCommandNames().includes('editor.action.formatSelection') },
      { edits: ['c\r\n'], formatted: true }
    );
  });

  test('the panel retry reruns the same goal', async () => {
    const request = goalRequest('a\r\nb\r\n', 'c\r\n');
    const panel = new CodeSceneCWFAceTabPanel();
    try {
      (panel as any).state = { request };
      await getWebviewMessageHandler()!({ messageType: 'retry' });
      assert.deepStrictEqual(lastCommand(), {
        command: 'codescene.requestAndPresentRefactoring',
        args: [document, 'retry', request.fnToRefactor, false, undefined, goal],
      });
    } finally {
      panel.dispose();
    }
  });

  test('acknowledging the agent runs the goal that was clicked', async () => {
    const request = goalRequest('a\r\nb\r\n', 'c\r\n');
    const panel = new CodeSceneCWFAceAcknowledgementTabPanel();
    (panel as any).state = { request };
    await getWebviewMessageHandler()!({ messageType: 'acknowledged' });
    await flushPromises();
    assert.deepStrictEqual(lastCommand(), {
      command: 'codescene.requestAndPresentRefactoring',
      args: [document, 'ace-acknowledgement', request.fnToRefactor, false, undefined, goal],
    });
  });

  test('a goal request snapshots the document after saving it', async () => {
    document.setText('unformatted\n');
    document.setDirty(true);
    document.setOnSave(() => document.setText('formatted\n'));
    warningAnswer = SAVE_AND_REFACTOR;
    const shown: RefactoringRequest[] = [];
    CodeSceneCWFAceTabPanel.show = (request: RefactoringRequest) => {
      shown.push(request);
    };
    await (commands as any).requestAndPresentRefactoringCmd(document, 'objectives', undefined, false, undefined, goal);
    assert.deepStrictEqual(
      shown.map((request) => ({ body: request.fnToRefactor.body, goal: request.goal })),
      [{ body: 'formatted\n', goal }]
    );
  });
});
