import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { CsRefactoringCommands } from '../../refactoring/commands';
import { RefactoringRequest } from '../../refactoring/request';
import { FixGoalTarget } from '../../refactoring/agent-types';
import { RefactorResponse } from '../../devtools-api/refactor-models';
import { DevtoolsAPI } from '../../devtools-api';
import { AbortError } from '../../devtools-api/abort-error';
import { AgentTimeoutError } from '../../refactoring/agent-process';
import { CsExtensionState } from '../../cs-extension-state';
import { CodeSceneCWFAceTabPanel } from '../../codescene-tab/webview/ace/cwf-webview-ace-panel';
import { CodeSceneCWFAceAcknowledgementTabPanel } from '../../codescene-tab/webview/ace/acknowledgement/cwf-webview-ace-acknowledgement-panel';
import { fixGoalJobs } from '../../objectives/fix-goal-jobs';
import { OPEN_GOAL_FIX, UNDO_GOAL_FIX } from '../../refactoring/goal-fix';
import { SAVE_AND_REFACTOR } from '../../refactoring/unsaved-changes';
import { aceSuite } from '../ace-test-suite';
import { flushPromises } from '../fakes/fake-auth-transport';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { TestTextDocument } from '../mocks/test-text-document';
import { getAppliedEdits, getMockProgress, resetAppliedEdits, resetMockProgress } from '../setup';

const original = 'a\nb\n';
const fixed = 'c\n';

const goal: FixGoalTarget = {
  goalId: 2,
  metricId: 'code-health',
  operator: 'greater-than-or-equal',
  target: 8.0,
  baseline: 6.2,
  repoRoot: '/repo',
  path: 'src/file.ts',
};
const goalFile = path.join(goal.repoRoot, goal.path);

function responseWith(code: string, outcome: 'reached' | 'improved' | 'unable' = 'reached'): RefactorResponse {
  return {
    code,
    confidence: { level: 3, title: 'Goal reached', 'recommended-action': { description: '', details: 'Goal reached: 6.2 → 8.0 (target 8.0)' } },
    reasons: [],
    'refactoring-properties': { 'removed-code-smells': [], 'added-code-smells': [] },
    metadata: {},
    'trace-id': 'trace-1',
    'goal-outcome': outcome,
  };
}

type Deferred = { resolve: (response: RefactorResponse) => void; reject: (error: Error) => void; request: RefactoringRequest };

aceSuite('Fix goal run Test Suite', () => {
  let commands: CsRefactoringCommands;
  let document: TestTextDocument;
  let pending: Deferred[];
  let infos: Array<{ message: string; items: string[] }>;
  let warnings: string[];
  let errors: string[];
  let infoAnswer: Promise<string | undefined>;
  let warningAnswer: string | undefined;
  let panelsShown: number;
  let acknowledgementsShown: RefactoringRequest[];
  let saved: string[];
  let shown: vscode.TextDocument[];

  const window = vscode.window as any;
  const originals = {
    postRefactoring: DevtoolsAPI.postRefactoring,
    showInformationMessage: window.showInformationMessage,
    showWarningMessage: window.showWarningMessage,
    showErrorMessage: window.showErrorMessage,
    showTextDocument: window.showTextDocument,
    panelShow: CodeSceneCWFAceTabPanel.show,
    acknowledgementShow: CodeSceneCWFAceAcknowledgementTabPanel.show,
  };

  setup(async () => {
    document = new TestTextDocument(goalFile, original, 'typescript');
    pending = [];
    infos = [];
    warnings = [];
    errors = [];
    infoAnswer = Promise.resolve(undefined);
    warningAnswer = undefined;
    panelsShown = 0;
    acknowledgementsShown = [];
    saved = [];
    shown = [];
    resetAppliedEdits();
    document.setOnSave(() => {
      const applied = editTexts().at(-1) ?? document.getText();
      document.setText(applied);
      saved.push(applied);
    });

    CsExtensionState.init(createMockExtensionContext('/test/fix-goal-run'));
    await CsExtensionState.setAcknowledgedAceUsage(true);

    (DevtoolsAPI as any).postRefactoring = (request: RefactoringRequest) =>
      new Promise<RefactorResponse>((resolve, reject) => pending.push({ resolve, reject, request }));
    window.showInformationMessage = (message: string, ...items: string[]) => {
      infos.push({ message, items });
      return infoAnswer;
    };
    window.showWarningMessage = async (message: string) => {
      warnings.push(message);
      return warningAnswer;
    };
    window.showErrorMessage = async (message: string) => {
      errors.push(message);
      return undefined;
    };
    window.showTextDocument = async (doc: vscode.TextDocument) => {
      shown.push(doc);
      return undefined;
    };
    CodeSceneCWFAceTabPanel.show = () => {
      panelsShown++;
    };
    CodeSceneCWFAceAcknowledgementTabPanel.show = (request: RefactoringRequest) => {
      acknowledgementsShown.push(request);
    };

    commands = new CsRefactoringCommands();
  });

  teardown(() => {
    commands.dispose();
    fixGoalJobs.clear();
    (DevtoolsAPI as any).postRefactoring = originals.postRefactoring;
    window.showInformationMessage = originals.showInformationMessage;
    window.showWarningMessage = originals.showWarningMessage;
    window.showErrorMessage = originals.showErrorMessage;
    window.showTextDocument = originals.showTextDocument;
    CodeSceneCWFAceTabPanel.show = originals.panelShow;
    CodeSceneCWFAceAcknowledgementTabPanel.show = originals.acknowledgementShow;
    resetAppliedEdits();
    resetMockProgress();
  });

  const fixGoal = (target: FixGoalTarget = goal, doc: vscode.TextDocument = document): Promise<void> =>
    (commands as any).requestAndPresentRefactoringCmd(doc, 'objectives', undefined, false, undefined, target);

  const editTexts = () => getAppliedEdits().flatMap((edit) => edit.replacements.map((r) => r.newText));
  const jobGoals = () => fixGoalJobs.jobs.map((job) => [job.goalId, job.file.fileName]);

  async function started(): Promise<void> {
    await flushPromises();
    assert.ok(pending.length > 0, 'the agent should have been asked to fix the goal');
  }

  test('the job is listed while the agent works and removed once the fix is applied', async () => {
    const run = fixGoal();
    await started();
    assert.deepStrictEqual(jobGoals(), [[2, goalFile]]);

    pending[0].resolve(responseWith(fixed));
    await run;
    assert.deepStrictEqual(
      { jobs: jobGoals(), edits: editTexts(), panelsShown },
      { jobs: [], edits: [fixed], panelsShown: 0 }
    );
  });

  test('the applied fix is saved so the goal is evaluated on the fixed file', async () => {
    const run = fixGoal();
    await started();
    pending[0].resolve(responseWith(fixed));
    await run;
    assert.deepStrictEqual({ saved, dirty: document.isDirty }, { saved: [fixed], dirty: false });
  });

  test('the applied fix is announced with Open and Undo actions', async () => {
    const run = fixGoal();
    await started();
    pending[0].resolve(responseWith(fixed));
    await run;
    assert.deepStrictEqual(infos, [
      { message: 'The Refactoring Agent changed file.ts. Goal reached: 6.2 → 8.0 (target 8.0).', items: [OPEN_GOAL_FIX, UNDO_GOAL_FIX] },
    ]);
  });

  async function answered(choice: string, afterFix?: () => void): Promise<void> {
    let answer!: (choice: string | undefined) => void;
    infoAnswer = new Promise((resolve) => (answer = resolve));
    const run = fixGoal();
    await started();
    pending[0].resolve(responseWith(fixed));
    await run;
    afterFix?.();
    answer(choice);
    await flushPromises();
  }

  test('Open shows the fixed file', async () => {
    await answered(OPEN_GOAL_FIX);
    assert.deepStrictEqual({ shown, edits: editTexts() }, { shown: [document], edits: [fixed] });
  });

  test('Undo puts the original file back and saves it', async () => {
    await answered(UNDO_GOAL_FIX);
    assert.deepStrictEqual({ edits: editTexts(), saved }, { edits: [fixed, original], saved: [fixed, original] });
  });

  test('Undo still applies when saving reformatted the fix', async () => {
    document.setOnSave(() => {
      const applied = editTexts().length === 1 ? 'c formatted\n' : original;
      document.setText(applied);
      saved.push(applied);
    });
    await answered(UNDO_GOAL_FIX);
    assert.deepStrictEqual({ edits: editTexts(), warnings }, { edits: [fixed, original], warnings: [] });
  });

  test('Undo refuses to touch a file that changed after the fix', async () => {
    await answered(UNDO_GOAL_FIX, () => document.setText('mine\n'));
    assert.deepStrictEqual({ edits: editTexts(), saved, warnings: warnings.length }, { edits: [fixed], saved: [fixed], warnings: 1 });
  });

  const failures: Array<{ name: string; finish: (deferred: Deferred) => void; before?: () => void; expect: { edits: number; infos: number; warnings: number; errors: number } }> = [
    { name: 'the agent fails', finish: (d) => d.reject(new Error('boom')), expect: { edits: 0, infos: 0, warnings: 0, errors: 1 } },
    { name: 'the agent finds no improvement', finish: (d) => d.resolve(responseWith(original, 'unable')), expect: { edits: 0, infos: 1, warnings: 0, errors: 0 } },
    {
      name: 'the file changed while the agent worked',
      finish: (d) => {
        document.setText('mine\n');
        d.resolve(responseWith(fixed));
      },
      expect: { edits: 0, infos: 0, warnings: 1, errors: 0 },
    },
  ];
  for (const { name, finish, expect } of failures) {
    test(`the job is removed and nothing is applied when ${name}`, async () => {
      const run = fixGoal();
      await started();
      finish(pending[0]);
      await run;
      assert.deepStrictEqual(
        { jobs: jobGoals(), edits: editTexts().length, infos: infos.length, warnings: warnings.length, errors: errors.length },
        { jobs: [], ...expect }
      );
    });
  }

  test('cancelling the progress notification aborts the run and removes the job', async () => {
    const run = fixGoal();
    await started();
    const [progress] = getMockProgress();
    progress.cancel();
    assert.deepStrictEqual(
      { cancellable: progress.cancellable, title: progress.title, aborted: pending[0].request.signal.aborted },
      { cancellable: true, title: 'Refactoring Agent: fixing file.ts', aborted: true }
    );
    pending[0].reject(new AbortError('aborted'));
    await run;
    assert.deepStrictEqual({ jobs: jobGoals(), errors }, { jobs: [], errors: [] });
  });

  test('a timed-out run says that it timed out', async () => {
    const run = fixGoal();
    await started();
    pending[0].reject(new AgentTimeoutError(20 * 60 * 1000));
    await run;
    assert.deepStrictEqual(errors, ['The Refactoring Agent could not fix file.ts. The Refactoring Agent did not finish within 20 minutes.']);
  });

  test('an aborted run is removed without an error', async () => {
    const run = fixGoal();
    await started();
    pending[0].reject(new AbortError('aborted'));
    await run;
    assert.deepStrictEqual({ jobs: jobGoals(), errors }, { jobs: [], errors: [] });
  });

  test('the job is removed when the save prompt is declined', async () => {
    document.setDirty(true);
    warningAnswer = undefined;
    await fixGoal();
    assert.deepStrictEqual({ jobs: jobGoals(), asked: pending.length }, { jobs: [], asked: 0 });
  });

  test('the job is removed when the acknowledgement is shown instead of running', async () => {
    await CsExtensionState.setAcknowledgedAceUsage(false);
    await fixGoal();
    assert.deepStrictEqual(
      { jobs: jobGoals(), asked: pending.length, goals: acknowledgementsShown.map((r) => r.goal) },
      { jobs: [], asked: 0, goals: [goal] }
    );
  });

  test('a saved file is fixed after the save prompt is accepted', async () => {
    document.setDirty(true);
    warningAnswer = SAVE_AND_REFACTOR;
    const run = fixGoal();
    await started();
    assert.deepStrictEqual(jobGoals(), [[2, goalFile]]);
    pending[0].resolve(responseWith(fixed));
    await run;
  });

  test('a second fix for the same goal and file while one runs is ignored', async () => {
    const run = fixGoal();
    await started();
    await fixGoal();
    assert.strictEqual(pending.length, 1);
    pending[0].resolve(responseWith(fixed));
    await run;
  });

  test('another goal or file runs alongside and keeps its own job', async () => {
    const otherFile = new TestTextDocument(path.join(goal.repoRoot, 'src/other.ts'), original, 'typescript');
    const runs = [fixGoal(), fixGoal({ ...goal, goalId: 5 }), fixGoal({ ...goal, path: 'src/other.ts' }, otherFile)];
    await started();
    assert.strictEqual(pending.length, 3);

    pending[0].resolve(responseWith(fixed));
    await runs[0];
    assert.deepStrictEqual(jobGoals(), [
      [5, goalFile],
      [2, path.join(goal.repoRoot, 'src/other.ts')],
    ]);

    pending[1].resolve(responseWith(original, 'unable'));
    pending[2].resolve(responseWith(original, 'unable'));
    await Promise.all(runs);
    assert.deepStrictEqual(jobGoals(), []);
  });
});
