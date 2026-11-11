import * as assert from 'assert';
import { RefactoringRequest } from '../../refactoring/request';
import { DevtoolsAPI } from '../../devtools-api';
import { FnToRefactor, RefactorResponse } from '../../devtools-api/refactor-models';
import { TestTextDocument } from '../mocks/test-text-document';
import { Range, Position } from '../mocks/vscode';
import { aceSuite } from '../ace-test-suite';

aceSuite('RefactoringRequest Test Suite', () => {
  let postRefactoringCallCount: number;
  let originalPostRefactoring: any;
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
  });

  teardown(() => {
    DevtoolsAPI.postRefactoring = originalPostRefactoring;
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

  test('the acknowledgement panel does not start the agent', () => {
    const doc = new TestTextDocument('test content', 'test.ts', 'typescript');
    const fnToRefactor = createMockFnToRefactor();

    new RefactoringRequest(fnToRefactor, doc);

    assert.strictEqual(postRefactoringCallCount, 0);
  });
});
