import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { TestTextDocument } from '../mocks/test-text-document';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { createTestDir, ensureBinary } from '../integration_helper';

suite('Delta Integration Test Suite', () => {
  const testDir = createTestDir('test-delta');
  let deltaEventFired = false;
  let lastDeltaEvent: any;
  let analysisError: Error | undefined;
  let errorListener: vscode.Disposable;

  function createTestFile(filename: string, content: string): TestTextDocument {
    const testFile = path.resolve(testDir, filename);
    fs.writeFileSync(testFile, content);
    return new TestTextDocument(testFile, content, 'cpp');
  }

  async function getReviewScore(filename: string, content: string): Promise<string | undefined> {
    const doc = createTestFile(filename, content);
    const review = await DevtoolsAPI.reviewContent(doc);
    return review?.['raw-score'];
  }

  function waitForEvent(ms: number = 1000): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function assertDeltaEventFired(expectedFileName: string, expectedUpdateMonitor: boolean) {
    assert.ok(deltaEventFired, 'Delta event should fire');
    assert.ok(lastDeltaEvent, 'Delta event should be captured');
    assert.strictEqual(lastDeltaEvent.document.fileName, expectedFileName);
    assert.strictEqual(lastDeltaEvent.updateMonitor, expectedUpdateMonitor);
  }

  function assertDeltaResultStructure(result: any) {
    assert.ok('score-change' in result);
    assert.ok('file-level-findings' in result);
    assert.ok('function-level-findings' in result);
    assert.ok(Array.isArray(result['file-level-findings']));
    assert.ok(Array.isArray(result['function-level-findings']));
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

    deltaEventFired = false;
    lastDeltaEvent = undefined;
    analysisError = undefined;

    DevtoolsAPI.onDidDeltaAnalysisComplete((event) => {
      deltaEventFired = true;
      lastDeltaEvent = event;
    });

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

  test('delta analysis detects code health degradation', async function() {
    this.timeout(60000);

    const cleanContent = 'int add(int a, int b) { return a + b; }\n';
    const complexContent = 'int f(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          return a;\n        }\n      }\n    }\n  }\n  return 0;\n}\n';

    const oldScore = await getReviewScore('example.cpp', cleanContent);
    assert.ok(oldScore, 'Old review should have a raw-score');

    const newScore = await getReviewScore('example.cpp', complexContent);
    assert.ok(newScore, 'New review should have a raw-score');
    assert.notStrictEqual(oldScore, newScore, 'Scores should differ after adding complexity');

    const complexDoc = createTestFile('example.cpp', complexContent);
    const result = await DevtoolsAPI.delta(complexDoc, true, oldScore, newScore);

    await waitForEvent(2000);

    assertNoAnalysisError();
    assertDeltaEventFired(complexDoc.fileName, true);

    assertDeltaResultStructure(result);
  });

  test('delta returns undefined when no scores provided', async function() {
    this.timeout(10000);

    const doc = createTestFile('test2.cpp', 'int foo() { return 42; }\n');
    const result = await DevtoolsAPI.delta(doc, false, undefined, undefined);

    assert.strictEqual(result, undefined, 'Should return undefined with no scores');
    assert.strictEqual(deltaEventFired, false, 'Event should not fire when skipped early');
  });

  test('delta returns undefined with only oldScore', async function() {
    this.timeout(30000);

    const content = 'int bar() { return 1; }\n';
    const score = await getReviewScore('test3.cpp', content);
    const doc = createTestFile('test3.cpp', content);

    await DevtoolsAPI.delta(doc, false, score, undefined);
    await waitForEvent();

    assertNoAnalysisError();
    assert.ok(deltaEventFired, 'Event should fire with old score only');
  });

  test('delta returns undefined with only newScore', async function() {
    this.timeout(30000);

    const content = 'int baz() { return 2; }\n';
    const score = await getReviewScore('test4.cpp', content);
    const doc = createTestFile('test4.cpp', content);

    await DevtoolsAPI.delta(doc, false, undefined, score);
    await waitForEvent();

    assertNoAnalysisError();
    assert.ok(deltaEventFired, 'Event should fire with new score only');
  });

  test('delta respects updateMonitor parameter', async function() {
    this.timeout(60000);

    const content1 = 'int x() { return 1; }\n';
    const content2 = 'int x(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      return a;\n    }\n  }\n  return 1;\n}\n';

    const score1 = await getReviewScore('test5.cpp', content1);
    const score2 = await getReviewScore('test5.cpp', content2);
    const doc2 = createTestFile('test5.cpp', content2);

    await DevtoolsAPI.delta(doc2, false, score1, score2);
    await waitForEvent();

    assertNoAnalysisError();
    assertDeltaEventFired(doc2.fileName, false);
  });

  test('delta skips when old and new scores are identical', async function() {
    this.timeout(30000);

    const content = 'int same() { return 0; }\n';
    const score = await getReviewScore('test6.cpp', content);
    const doc = createTestFile('test6.cpp', content);

    const result = await DevtoolsAPI.delta(doc, true, score, score);
    await waitForEvent(500);

    assert.strictEqual(result, undefined, 'Should return undefined for identical scores');
    assert.strictEqual(deltaEventFired, false, 'Event should not fire when scores are identical');
  });
});
