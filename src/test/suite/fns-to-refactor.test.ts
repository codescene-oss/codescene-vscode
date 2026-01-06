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

    const cleanContent = 'int f(int a) { return a + 1; }\n';
    const complexContent = 'int f(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          return a;\n        }\n      }\n    }\n  }\n  return 0;\n}\n';

    const cleanDoc = createTestFile('complex.cpp', cleanContent);
    const cleanReview = await DevtoolsAPI.reviewContent(cleanDoc);
    const oldScore = cleanReview?.['raw-score'];
    assert.ok(oldScore, 'Clean review should have a raw-score');

    const complexDoc = createTestFile('complex.cpp', complexContent);
    const complexReview = await DevtoolsAPI.reviewContent(complexDoc);
    const newScore = complexReview?.['raw-score'];
    assert.ok(newScore, 'Complex review should have a raw-score');

    const deltaResult = await DevtoolsAPI.delta(complexDoc, false, oldScore, newScore);

    assertNoAnalysisError();

    assert.ok(deltaResult, 'Delta should return a result');
    assert.ok(deltaResult['function-level-findings'].length > 0, 'Delta should have function-level findings');

    const result = await DevtoolsAPI.fnsToRefactorFromDelta(complexDoc, deltaResult);

    assertNoAnalysisError();

    assert.deepStrictEqual(result, [
      {
        name: 'f',
        body: 'int f(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          return a;\n        }\n      }\n    }\n  }\n  return 0;\n}',
        range: {
          'start-line': 1,
          'start-column': 1,
          'end-line': 12,
          'end-column': 2
        },
        'file-type': 'cpp',
        'refactoring-targets': [
          {
            category: 'Deep, Nested Complexity',
            line: 1
          }
        ],
        vscodeRange: new vscode.Range(0, 0, 11, 1),
        'nippy-b64': 'TlBZAHAFagRuYW1laQFmagRib2R5EACUaW50IGYoaW50IGEpIHsKICBpZiAoYSA+IDApIHsKICAgIGlmIChhID4gMSkgewogICAgICBpZiAoYSA+IDIpIHsKICAgICAgICBpZiAoYSA+IDMpIHsKICAgICAgICAgIHJldHVybiBhOwogICAgICAgIH0KICAgICAgfQogICAgfQogIH0KICByZXR1cm4gMDsKfWoJZmlsZS10eXBlaQNjcHBqBXJhbmdlcARqCnN0YXJ0LWxpbmUqAAAAAWoIZW5kLWxpbmUqAAAADGoMc3RhcnQtY29sdW1uZAFqCmVuZC1jb2x1bW5kAmoTcmVmYWN0b3JpbmctdGFyZ2V0c24BcAJqCGNhdGVnb3J5aRdEZWVwLCBOZXN0ZWQgQ29tcGxleGl0eWoEbGluZSoAAAAB'
      }
    ]);

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

    const cleanContent = 'int complex(int a) { return a + 1; }\n';
    const complexContent = 'int complex(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          if (a > 4) {\n            return a;\n          }\n        }\n      }\n    }\n  }\n  return 0;\n}\n';

    const cleanDoc = createTestFile('nested.cpp', cleanContent);
    const cleanReview = await DevtoolsAPI.reviewContent(cleanDoc);
    const oldScore = cleanReview?.['raw-score'];
    assert.ok(oldScore, 'Clean review should have a raw-score');

    const complexDoc = createTestFile('nested.cpp', complexContent);
    const complexReview = await DevtoolsAPI.reviewContent(complexDoc);
    const newScore = complexReview?.['raw-score'];
    assert.ok(newScore, 'Complex review should have a raw-score');

    const deltaResult = await DevtoolsAPI.delta(complexDoc, false, oldScore, newScore);

    assertNoAnalysisError();

    assert.ok(deltaResult, 'Delta should return a result');
    assert.ok(deltaResult['function-level-findings'].length > 0, 'Delta should have function-level findings');

    const result = await DevtoolsAPI.fnsToRefactorFromDelta(complexDoc, deltaResult);

    assertNoAnalysisError();

    assert.deepStrictEqual(result, [
      {
        name: 'complex',
        body: 'int complex(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          if (a > 4) {\n            return a;\n          }\n        }\n      }\n    }\n  }\n  return 0;\n}',
        range: {
          'start-line': 1,
          'start-column': 1,
          'end-line': 14,
          'end-column': 2
        },
        'file-type': 'cpp',
        'refactoring-targets': [
          {
            category: 'Deep, Nested Complexity',
            line: 1
          }
        ],
        vscodeRange: new vscode.Range(0, 0, 13, 1),
        'nippy-b64': 'TlBZAHAFagRuYW1laQdjb21wbGV4agRib2R5EAC/aW50IGNvbXBsZXgoaW50IGEpIHsKICBpZiAoYSA+IDApIHsKICAgIGlmIChhID4gMSkgewogICAgICBpZiAoYSA+IDIpIHsKICAgICAgICBpZiAoYSA+IDMpIHsKICAgICAgICAgIGlmIChhID4gNCkgewogICAgICAgICAgICByZXR1cm4gYTsKICAgICAgICAgIH0KICAgICAgICB9CiAgICAgIH0KICAgIH0KICB9CiAgcmV0dXJuIDA7Cn1qCWZpbGUtdHlwZWkDY3BwagVyYW5nZXAEagpzdGFydC1saW5lKgAAAAFqCGVuZC1saW5lKgAAAA5qDHN0YXJ0LWNvbHVtbmQBagplbmQtY29sdW1uZAJqE3JlZmFjdG9yaW5nLXRhcmdldHNuAXACaghjYXRlZ29yeWkXRGVlcCwgTmVzdGVkIENvbXBsZXhpdHlqBGxpbmUqAAAAAQ=='
      }
    ]);

    assert.ok(result, 'Result should not be undefined');
    assert.ok(result.length > 0, 'Should find at least one refactorable function');
    const fn = result[0]!;
    assert.ok(fn['refactoring-targets'].length > 0, 'Should have refactoring targets');
    const target = fn['refactoring-targets'][0]!;
    assert.ok(target.category, 'Target should have a category');
    assert.ok(typeof target.line === 'number', 'Target should have a line number');
  });
});
