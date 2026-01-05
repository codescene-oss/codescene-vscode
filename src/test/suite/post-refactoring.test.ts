import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { TestTextDocument } from '../mocks/test-text-document';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { RefactoringRequest } from '../../refactoring/request';
import { FnToRefactor } from '../../devtools-api/refactor-models';
import { ChangeType } from '../../devtools-api/delta-model';
import * as configModule from '../../configuration';
import * as csExtensionState from '../../cs-extension-state';
import { createTestDir, ensureBinary } from '../integration_helper';

suite('PostRefactoring Integration Test Suite', () => {
  const testDir = createTestDir('test-post-refactoring');
  const testToken = process.env.CODESCENE_TEST_TOKEN;
  let analysisError: Error | undefined;
  let refactoringError: Error | undefined;
  let errorListener: vscode.Disposable;
  let refactoringErrorListener: vscode.Disposable;
  let originalGetAuthToken: any;

  if (!testToken) {
    console.log('Skipping PostRefactoring tests: CODESCENE_TEST_TOKEN environment variable not set');
    return;
  }

  function createTestFile(filename: string, content: string, languageId: string = 'cpp'): TestTextDocument {
    const testFile = path.resolve(testDir, filename);
    fs.writeFileSync(testFile, content);
    return new TestTextDocument(testFile, content, languageId);
  }

  function assertNoAnalysisError() {
    if (analysisError) {
      assert.fail(`Analysis failed with error: ${analysisError.message}\n${analysisError.stack}`);
    }
  }

  function assertNoRefactoringError() {
    if (refactoringError) {
      assert.fail(`Refactoring failed with error: ${refactoringError.message}\n${refactoringError.stack}`);
    }
  }

  setup(async function() {
    this.timeout(60000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);

    const binaryPath = await ensureBinary();
    const mockContext = createMockExtensionContext(testDir);

    originalGetAuthToken = configModule.getAuthToken;
    (configModule as any).getAuthToken = () => testToken;

    Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', {
      get: () => ({
        session: undefined,
        features: {
          analysis: { state: 'enabled' },
          ace: { state: 'enabled' }
        }
      }),
      configurable: true
    });

    DevtoolsAPI.init(binaryPath, mockContext);

    analysisError = undefined;
    refactoringError = undefined;

    errorListener = DevtoolsAPI.onDidAnalysisFail((error) => {
      analysisError = error;
    });

    refactoringErrorListener = DevtoolsAPI.onDidRefactoringFail((error) => {
      refactoringError = error;
    });

    await DevtoolsAPI.preflight();
  });

  teardown(() => {
    errorListener?.dispose();
    refactoringErrorListener?.dispose();

    if (originalGetAuthToken) {
      (configModule as any).getAuthToken = originalGetAuthToken;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });

  test('postRefactoring returns refactoring response', async function() {
    this.timeout(60000);

    const complexContent = 'int f(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          return a;\n        }\n      }\n    }\n  }\n  return 0;\n}\n';

    const doc = createTestFile('complex.cpp', complexContent);
    const review = await DevtoolsAPI.reviewContent(doc);

    assert.ok(review, 'Review should return a result');
    assert.ok(review?.['raw-score'], 'Review should have a raw-score');

    const deltaResult = {
      'score-change': -1.5,
      'file-level-findings': [],
      'function-level-findings': [{
        function: {
          name: 'f',
          range: {
            'start-line': 1,
            'start-column': 1,
            'end-line': 12,
            'end-column': 2
          }
        },
        'change-details': [{
          category: 'Deep, Nested Complexity',
          'change-type': ChangeType.Degraded,
          description: 'Nested complexity increased to depth = 5',
          line: 2
        }]
      }]
    };

    const fnsToRefactor = await DevtoolsAPI.fnsToRefactorFromDelta(doc, deltaResult);

    assertNoAnalysisError();

    assert.ok(Array.isArray(fnsToRefactor), 'Result should be an array');
    assert.ok(fnsToRefactor.length > 0, 'Should find at least one refactorable function');

    const fnToRefactor = fnsToRefactor[0];
    const request = new RefactoringRequest(fnToRefactor, doc, false);

    const response = await request.promise;

    assertNoRefactoringError();

    assert.ok(response, 'Response should be defined');
    assert.ok(response.code, 'Response should have code');
    assert.ok(response.confidence, 'Response should have confidence');
    assert.ok(response['trace-id'], 'Response should have trace-id');
    assert.ok(Array.isArray(response.reasons), 'Response should have reasons array');
    assert.ok(response['refactoring-properties'], 'Response should have refactoring-properties');
    assert.ok(response.metadata, 'Response should have metadata');
    assert.strictEqual(typeof response.confidence.level, 'number', 'Confidence level should be a number');
  });

  test('postRefactoring with skipCache parameter', async function() {
    this.timeout(90000);

    const content = 'int nested(int x) {\n  if (x > 0) {\n    if (x > 1) {\n      if (x > 2) {\n        return x * 2;\n      }\n    }\n  }\n  return 0;\n}\n';

    const doc = createTestFile('nested.cpp', content);
    const review = await DevtoolsAPI.reviewContent(doc);

    assert.ok(review?.['raw-score'], 'Review should have a raw-score');

    const deltaResult = {
      'score-change': -1.2,
      'file-level-findings': [],
      'function-level-findings': [{
        function: {
          name: 'nested',
          range: {
            'start-line': 1,
            'start-column': 1,
            'end-line': 10,
            'end-column': 2
          }
        },
        'change-details': [{
          category: 'Deep, Nested Complexity',
          'change-type': ChangeType.Degraded,
          description: 'Nested complexity increased',
          line: 2
        }]
      }]
    };

    const fnsToRefactor = await DevtoolsAPI.fnsToRefactorFromDelta(doc, deltaResult);

    assertNoAnalysisError();
    assert.ok(fnsToRefactor && fnsToRefactor.length > 0, 'Should find refactorable functions');

    const fnToRefactor = fnsToRefactor[0];

    const request1 = new RefactoringRequest(fnToRefactor, doc, false);
    const response1 = await request1.promise;

    assertNoRefactoringError();
    assert.ok(response1, 'First response should be defined');

    const request2 = new RefactoringRequest(fnToRefactor, doc, true);
    const response2 = await request2.promise;

    assertNoRefactoringError();
    assert.ok(response2, 'Second response should be defined');
    assert.ok(response2.code, 'Second response should have code');
  });

  test('postRefactoring handles refactoring targets', async function() {
    this.timeout(60000);

    const content = 'int complex(int a, int b, int c, int d, int e) {\n  if (a > 0) {\n    if (b > 0) {\n      if (c > 0) {\n        if (d > 0) {\n          if (e > 0) {\n            return a + b + c + d + e;\n          }\n        }\n      }\n    }\n  }\n  return 0;\n}\n';

    const doc = createTestFile('targets.cpp', content);
    const review = await DevtoolsAPI.reviewContent(doc);

    assert.ok(review?.['raw-score'], 'Review should have a raw-score');

    const deltaResult = {
      'score-change': -2.0,
      'file-level-findings': [],
      'function-level-findings': [{
        function: {
          name: 'complex',
          range: {
            'start-line': 1,
            'start-column': 1,
            'end-line': 14,
            'end-column': 2
          }
        },
        'change-details': [{
          category: 'Deep, Nested Complexity',
          'change-type': ChangeType.Degraded,
          description: 'Nested complexity increased to depth = 6',
          line: 2
        }]
      }]
    };

    const fnsToRefactor = await DevtoolsAPI.fnsToRefactorFromDelta(doc, deltaResult);

    assertNoAnalysisError();
    assert.ok(fnsToRefactor && fnsToRefactor.length > 0, 'Should find refactorable functions');

    const fnToRefactor = fnsToRefactor[0];
    assert.ok(fnToRefactor['refactoring-targets'].length > 0, 'Should have refactoring targets');

    const request = new RefactoringRequest(fnToRefactor, doc, false);
    const response = await request.promise;

    assertNoRefactoringError();

    assert.ok(response, 'Response should be defined');
    assert.ok(response['refactoring-properties'], 'Response should have refactoring properties');
    assert.ok(Array.isArray(response['refactoring-properties']['removed-code-smells']), 'Should have removed code smells array');
    assert.ok(Array.isArray(response['refactoring-properties']['added-code-smells']), 'Should have added code smells array');
  });

  test('postRefactoring response includes confidence information', async function() {
    this.timeout(60000);

    const content = 'int test(int x) {\n  if (x > 0) {\n    if (x > 1) {\n      if (x > 2) {\n        return x;\n      }\n    }\n  }\n  return 0;\n}\n';

    const doc = createTestFile('confidence.cpp', content);
    const review = await DevtoolsAPI.reviewContent(doc);

    assert.ok(review?.['raw-score'], 'Review should have a raw-score');

    const deltaResult = {
      'score-change': -1.0,
      'file-level-findings': [],
      'function-level-findings': [{
        function: {
          name: 'test',
          range: {
            'start-line': 1,
            'start-column': 1,
            'end-line': 10,
            'end-column': 2
          }
        },
        'change-details': [{
          category: 'Deep, Nested Complexity',
          'change-type': ChangeType.Degraded,
          description: 'Nested complexity increased',
          line: 2
        }]
      }]
    };

    const fnsToRefactor = await DevtoolsAPI.fnsToRefactorFromDelta(doc, deltaResult);

    assertNoAnalysisError();
    assert.ok(fnsToRefactor && fnsToRefactor.length > 0, 'Should find refactorable functions');

    const fnToRefactor = fnsToRefactor[0];
    const request = new RefactoringRequest(fnToRefactor, doc, false);
    const response = await request.promise;

    assertNoRefactoringError();

    assert.ok(response.confidence, 'Response should have confidence');
    assert.ok(typeof response.confidence.level === 'number', 'Confidence level should be a number');
    assert.ok(response.confidence.title, 'Confidence should have a title');
    assert.ok(response.confidence['recommended-action'], 'Confidence should have recommended action');
    assert.ok(response.confidence['recommended-action'].description, 'Recommended action should have description');
    assert.ok(response.confidence['recommended-action'].details, 'Recommended action should have details');
  });
});
