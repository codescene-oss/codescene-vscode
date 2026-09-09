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

import { aceSuite } from '../ace-test-suite';

aceSuite('FnsToRefactor Integration Test Suite', () => {
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

    DevtoolsAPI.init(binaryPath, mockContext, async () => false);

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

});
