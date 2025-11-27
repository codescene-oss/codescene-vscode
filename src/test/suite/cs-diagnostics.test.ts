import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import CsDiagnostics from '../../diagnostics/cs-diagnostics';
import Reviewer, { ReviewOpts } from '../../review/reviewer';
import { TestTextDocument } from '../mocks/test-text-document';
import { MockDiagnosticCollection } from '../mocks/mock-diagnostic-collection';
import { DevtoolsAPI } from '../../devtools-api';
import { ArtifactInfo } from '../../artifact-info';
import { ensureCompatibleBinary } from '../../download';

suite('CsDiagnostics Integration Test Suite', () => {
  const testDir = path.join(__dirname, '../../../test-cs-diagnostics');
  let mockCollection: MockDiagnosticCollection;
  let originalCollection: vscode.DiagnosticCollection;

  setup(async function() {
    this.timeout(60000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    const extensionPath = path.join(__dirname, '../../..');
    const binaryPath = new ArtifactInfo(extensionPath).absoluteBinaryPath;

    if (!fs.existsSync(binaryPath)) {
      console.log(`CLI binary not found at ${binaryPath}, attempting to download...`);
      try {
        await ensureCompatibleBinary(extensionPath);
        console.log(`CLI binary downloaded successfully to ${binaryPath}`);
      } catch (error) {
        throw new Error(
          `CLI binary not found and download failed. ` +
          `Expected binary at: ${binaryPath}. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `CLI binary still not found after download attempt. ` +
        `Expected at: ${binaryPath}. ` +
        `Please ensure the binary is available for platform: ${process.platform}-${process.arch}`
      );
    }

    const mockContext = {
      subscriptions: [] as vscode.Disposable[],
      extensionPath: path.join(__dirname, '../../..'),
      extensionUri: vscode.Uri.file(path.join(__dirname, '../../..')),
      globalState: {} as any,
      workspaceState: {} as any,
      secrets: {} as any,
      storagePath: testDir,
      globalStoragePath: testDir,
      logPath: testDir,
      extensionMode: 3 // ExtensionMode.Test
    } as vscode.ExtensionContext;

    DevtoolsAPI.init(binaryPath, mockContext);
    mockCollection = new MockDiagnosticCollection();
    originalCollection = (CsDiagnostics as any).collection;
    (CsDiagnostics as any).collection = mockCollection;
    CsDiagnostics.init(mockContext);
    Reviewer.init(mockContext, async () => undefined, () => new Map());
  });

  teardown(() => {
    if (originalCollection) {
      (CsDiagnostics as any).collection = originalCollection;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('review C++ code with code smells', async function() {
    this.timeout(60000);
    const fixtureSourcePath = path.join(__dirname, '../../../src/test/fixtures/gc.cpp');
    const expectedResultsPath = path.join(__dirname, '../../../src/test/fixtures/gc.cpp.expected.json');
    assert.ok(fs.existsSync(fixtureSourcePath), `Fixture file should exist at ${fixtureSourcePath}`);
    assert.ok(fs.existsSync(expectedResultsPath), `Expected results should exist at ${expectedResultsPath}`);

    const fileContent = fs.readFileSync(fixtureSourcePath, 'utf-8');
    const testFile = path.resolve(testDir, 'gc.cpp');
    fs.writeFileSync(testFile, fileContent);
    const document = new TestTextDocument(testFile, fileContent, 'cpp');
    const reviewOpts: ReviewOpts = { skipMonitorUpdate: true, updateDiagnosticsPane: true };
    CsDiagnostics.review(document, reviewOpts);

    const start1 = Date.now();
    const diagnosticsFromReviewer = await Reviewer.instance.review(document, reviewOpts).diagnostics;
    const duration1 = Date.now() - start1;
    await new Promise(resolve => setTimeout(resolve, 1000));

    const diagnostics = mockCollection.get(document.uri);
    const expectedResults = JSON.parse(fs.readFileSync(expectedResultsPath, 'utf-8'));
    const expectedFileSmellsCount = expectedResults['file-level-code-smells'].length;

    assert.ok(diagnosticsFromReviewer.length > 0, `Reviewer should return diagnostics for gc.cpp (got ${diagnosticsFromReviewer.length})`);
    assert.ok(diagnostics, 'Diagnostics should be set in collection');
    assert.ok(diagnostics!.length > 0, `Should have diagnostics in collection (got ${diagnostics!.length})`);

    const firstDiagnostic = diagnostics![0];
    assert.ok(firstDiagnostic.message, 'Diagnostic should have a message');
    assert.ok(firstDiagnostic.range, 'Diagnostic should have a range');
    assert.ok(firstDiagnostic.severity !== undefined, 'Diagnostic should have severity');
    assert.ok(diagnostics!.length >= expectedFileSmellsCount,
              `Should have at least ${expectedFileSmellsCount} diagnostics (file-level smells)`);

    const start2 = Date.now();
    await Reviewer.instance.review(document, reviewOpts).diagnostics;
    const duration2 = Date.now() - start2;

    if (duration2 === 0) {
      assert.ok(true, `Cache was instant (0ms), first review took ${duration1}ms`);
    } else {
      const ratio = duration1 / duration2;
      assert.ok(ratio >= 5,
                `Second review should be at least 5x faster due to caching (first: ${duration1}ms, second: ${duration2}ms, ratio: ${ratio.toFixed(2)}x)`);
    }
  });

  test('review clean code', async function() {
    this.timeout(30000);
    const cleanFile = path.join(testDir, 'clean.cpp');
    const cleanCode = `#include <iostream>

int add(int a, int b) {
return a + b;
}

int main() {
std::cout << "Hello World" << std::endl;
return 0;
}
`;
    fs.writeFileSync(cleanFile, cleanCode);
    const document = new TestTextDocument(cleanFile, cleanCode, 'cpp');
    const reviewOpts: ReviewOpts = { skipMonitorUpdate: true, updateDiagnosticsPane: true };
    CsDiagnostics.review(document, reviewOpts);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const diagnostics = mockCollection.get(document.uri);
    assert.ok(diagnostics !== undefined, 'Diagnostics should be set');
  });

  test('review respects document selector for C++ files', async function() {
    this.timeout(30000);
    const cppFile = path.join(testDir, 'example.cpp');
    const code = `int foo() { return 42; }\n`;
    fs.writeFileSync(cppFile, code);
    const document = new TestTextDocument(cppFile, code, 'cpp');
    const reviewOpts: ReviewOpts = { skipMonitorUpdate: true, updateDiagnosticsPane: true };
    CsDiagnostics.review(document, reviewOpts);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const diagnostics = mockCollection.get(document.uri);
    assert.ok(diagnostics !== undefined, 'C++ file should be reviewed');
  });

  test('review ignores unsupported file types', async function() {
    this.timeout(10000);
    const txtFile = path.join(testDir, 'readme.txt');
    const content = 'This is just text';
    fs.writeFileSync(txtFile, content);
    const document = new TestTextDocument(txtFile, content, 'plaintext');
    const reviewOpts: ReviewOpts = { skipMonitorUpdate: true, updateDiagnosticsPane: true };
    mockCollection.clear();
    CsDiagnostics.review(document, reviewOpts);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const diagnostics = mockCollection.get(document.uri);
    assert.ok(diagnostics === undefined, 'Unsupported file should not be reviewed');
  });
});
