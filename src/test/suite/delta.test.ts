import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { TestTextDocument } from '../mocks/test-text-document';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { createTestDir, ensureBinary } from '../integration_helper';

import { aceTest } from '../ace-test-suite';

suite('Delta Integration Test Suite', () => {
  const testDir = createTestDir('test-delta');
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
  });

  teardown(() => {
    errorListener?.dispose();

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });


  aceTest('fnsToRefactor with code-smells path returns refactorable functions', async function() {
    this.timeout(60000);

    const complexContent = 'int f(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          return a;\n        }\n      }\n    }\n  }\n  return 0;\n}\n';
    const doc = createTestFile('test7.cpp', complexContent);

    const review = await DevtoolsAPI.reviewContent(doc);
    assertNoAnalysisError();
    assert.ok(review, 'Review should be defined');

    await DevtoolsAPI.preflight();

    const functionLevelSmells = review['function-level-code-smells'];
    assert.ok(functionLevelSmells.length > 0, 'Should have function-level code smells');

    const firstFunction = functionLevelSmells[0];
    assert.ok(firstFunction['code-smells'].length > 0, 'Function should have code smells');

    const codeSmell = firstFunction['code-smells'][0];

    const result = await DevtoolsAPI.fnsToRefactor(doc, { 'code-smells': [codeSmell] });

    const expected = [{
      'file-type': 'cpp',
      'nippy-b64': 'TlBZAHAFagRuYW1laQFmagRib2R5EACUaW50IGYoaW50IGEpIHsKICBpZiAoYSA+IDApIHsKICAgIGlmIChhID4gMSkgewogICAgICBpZiAoYSA+IDIpIHsKICAgICAgICBpZiAoYSA+IDMpIHsKICAgICAgICAgIHJldHVybiBhOwogICAgICAgIH0KICAgICAgfQogICAgfQogIH0KICByZXR1cm4gMDsKfWoJZmlsZS10eXBlaQNjcHBqBXJhbmdlcARqCnN0YXJ0LWxpbmUqAAAAAWoIZW5kLWxpbmUqAAAADGoMc3RhcnQtY29sdW1uZAFqCmVuZC1jb2x1bW5kAmoTcmVmYWN0b3JpbmctdGFyZ2V0c24BcAJqCGNhdGVnb3J5aRdEZWVwLCBOZXN0ZWQgQ29tcGxleGl0eWoEbGluZSoAAAAB',
      'refactoring-targets': [
        {
          category: 'Deep, Nested Complexity',
          line: 1
        }
      ],
      body: 'int f(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          return a;\n        }\n      }\n    }\n  }\n  return 0;\n}',
      name: 'f',
      range: {
        'start-line': 1,
        'start-column': 1,
        'end-line': 12,
        'end-column': 2
      },
      vscodeRange: new vscode.Range(0, 0, 11, 1)
    }];

    assert.deepStrictEqual(result, expected, 'Result should match expected structure');
  });
});
