import * as assert from 'assert';
import { RefactoringRequest } from '../../refactoring/request';
import { DevtoolsAPI } from '../../devtools-api';
import { FnToRefactor, RefactorResponse } from '../../devtools-api/refactor-models';
import { TestTextDocument } from '../mocks/test-text-document';
import { Range, Position } from '../mocks/vscode';
import { aceSuite } from '../ace-test-suite';
import { CsExtensionState } from '../../cs-extension-state';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { CsRefactoringCommands } from '../../refactoring/commands';
import * as unsavedChanges from '../../refactoring/unsaved-changes';
import { CodeSceneCWFAceAcknowledgementTabPanel } from '../../codescene-tab/webview/ace/acknowledgement/cwf-webview-ace-acknowledgement-panel';

aceSuite('RefactoringRequest Test Suite', () => {
  let postRefactoringCallCount: number;
  let originalPostRefactoring: any;
  let originalEnsureSaved: any;
  let originalPanelShow: any;
  const mockResponse: RefactorResponse = {
    code: 'refactored code',
    confidence: {
      level: 3,
      'recommended-action': { description: 'test', details: 'test' },
      title: 'test',
    },
    metadata: { 'cached?': false },
    reasons: [],
    'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
    'trace-id': 'test-trace-id',
  };

  function createMockFnToRefactor(): FnToRefactor {
    return {
      name: 'testFn',
      body: 'function testFn() {}',
      'file-type': 'typescript',
      range: {
        'start-line': 1,
        'start-column': 1,
        'end-line': 10,
        'end-column': 1,
      },
      'refactoring-targets': [{ category: 'Complex Method', line: 1 }],
      vscodeRange: new Range(new Position(0, 0), new Position(9, 0)) as any,
    };
  }

  setup(() => {
    postRefactoringCallCount = 0;
    originalPostRefactoring = DevtoolsAPI.postRefactoring;
    DevtoolsAPI.postRefactoring = async () => {
      postRefactoringCallCount++;
      return Promise.resolve(mockResponse);
    };
    originalEnsureSaved = unsavedChanges.ensureSavedForRefactoring;
    (unsavedChanges as any).ensureSavedForRefactoring = async () => true;
    originalPanelShow = CodeSceneCWFAceAcknowledgementTabPanel.show;
    CodeSceneCWFAceAcknowledgementTabPanel.show = () => {};
  });

  teardown(() => {
    DevtoolsAPI.postRefactoring = originalPostRefactoring;
    (unsavedChanges as any).ensureSavedForRefactoring = originalEnsureSaved;
    CodeSceneCWFAceAcknowledgementTabPanel.show = originalPanelShow;
  });

  test('constructing a request does not start the agent', () => {
    const doc = new TestTextDocument('test content', 'test.ts', 'typescript');
    const fnToRefactor = createMockFnToRefactor();

    new RefactoringRequest(fnToRefactor, doc);

    assert.strictEqual(postRefactoringCallCount, 0);
  });

  test('reading promise starts the agent once', async () => {
    const doc = new TestTextDocument('test content', 'test.ts', 'typescript');
    const fnToRefactor = createMockFnToRefactor();

    const request = new RefactoringRequest(fnToRefactor, doc);

    const promise1 = request.promise;
    const promise2 = request.promise;

    assert.strictEqual(postRefactoringCallCount, 1);
    assert.strictEqual(promise1, promise2);

    await promise1;
  });

  test('the acknowledgement panel does not start the agent', async () => {
    const context = createMockExtensionContext('/tmp/test');
    CsExtensionState.init(context);
    await CsExtensionState.setAcknowledgedAceUsage(false);

    const commands = new CsRefactoringCommands();
    const doc = new TestTextDocument('test content', 'test.ts', 'typescript');
    const fnToRefactor = createMockFnToRefactor();

    await (commands as any).requestAndPresentRefactoringCmd(doc, 'test-source', fnToRefactor);

    assert.strictEqual(postRefactoringCallCount, 0);

    commands.dispose();
  });
});
