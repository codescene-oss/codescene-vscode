import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { TestTextDocument } from '../mocks/test-text-document';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { ChangeType } from '../../devtools-api/delta-model';
import { createTestDir, ensureBinary } from '../integration_helper';

suite('FnsToRefactor Integration Test Suite', () => {
  const testDir = createTestDir('test-fns-to-refactor');
  let analysisError: Error | undefined;
  let errorListener: vscode.Disposable;

  function createTestFile(filename: string, content: string): TestTextDocument {
    const testFile = path.resolve(testDir, filename);
    fs.writeFileSync(testFile, content);
    return new TestTextDocument(testFile, content, 'cpp');
  }

  function assertNoAnalysisError() {
    if (analysisError) {
      assert.fail(`Analysis failed with error: ${analysisError.message}\n${analysisError.stack}`);
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

    DevtoolsAPI.init(binaryPath, mockContext);

    analysisError = undefined;

    errorListener = DevtoolsAPI.onDidAnalysisFail((error) => {
      analysisError = error;
    });

    await DevtoolsAPI.preflight();
  });

  teardown(() => {
    errorListener?.dispose();

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });

  test('fnsToRefactorFromDelta returns refactorable functions', async function() {
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

    const result = await DevtoolsAPI.fnsToRefactorFromDelta(doc, deltaResult);

    assertNoAnalysisError();

    assert.ok(Array.isArray(result), 'Result should be an array');
    assert.ok(result.length > 0, 'Should find at least one refactorable function');
    const fn = result[0];
    assert.ok(fn.name, 'Function should have a name');
    assert.ok(fn.body, 'Function should have a body');
    assert.ok(fn.range, 'Function should have a range');
    assert.ok(fn['file-type'], 'Function should have a file-type');
    assert.ok(fn['refactoring-targets'], 'Function should have refactoring-targets');
    assert.ok(Array.isArray(fn['refactoring-targets']), 'Refactoring targets should be an array');
    assert.ok(fn.vscodeRange, 'Function should have a vscodeRange');
  });

  test('fnsToRefactorFromDelta returns undefined when ACE is disabled', async function() {
    this.timeout(10000);

    DevtoolsAPI.disableAce();

    const content = 'int foo() { return 42; }\n';
    const doc = createTestFile('test-disabled.cpp', content);

    const deltaResult = {
      'score-change': -1.0,
      'file-level-findings': [],
      'function-level-findings': []
    };

    const result = await DevtoolsAPI.fnsToRefactorFromDelta(doc, deltaResult);

    assert.strictEqual(result, undefined, 'Should return undefined when ACE is disabled');
  });

  test('fnsToRefactorFromDelta handles delta with no function findings', async function() {
    this.timeout(60000);

    const cleanContent = 'int add(int a, int b) { return a + b; }\n';
    const doc = createTestFile('clean.cpp', cleanContent);

    const deltaResult = {
      'score-change': 0.0,
      'file-level-findings': [],
      'function-level-findings': []
    };

    const result = await DevtoolsAPI.fnsToRefactorFromDelta(doc, deltaResult);

    assertNoAnalysisError();

    assert.ok(Array.isArray(result), 'Result should be an array');
    assert.strictEqual(result.length, 0, 'Should return empty array for delta with no findings');
  });

  test('fnsToRefactorFromDelta includes refactoring targets from delta', async function() {
    this.timeout(60000);

    const content = 'int complex(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          if (a > 4) {\n            return a;\n          }\n        }\n      }\n    }\n  }\n  return 0;\n}\n';
    const doc = createTestFile('nested.cpp', content);

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

    const result = await DevtoolsAPI.fnsToRefactorFromDelta(doc, deltaResult);

    assertNoAnalysisError();

    assert.ok(result, 'Result should not be undefined');
    assert.ok(result.length > 0, 'Should find at least one refactorable function');
    const fn = result[0]!;
    assert.ok(fn['refactoring-targets'].length > 0, 'Should have refactoring targets');
    const target = fn['refactoring-targets'][0]!;
    assert.ok(target.category, 'Target should have a category');
    assert.ok(typeof target.line === 'number', 'Target should have a line number');
  });
});
