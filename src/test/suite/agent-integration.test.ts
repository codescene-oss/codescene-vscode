import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { TestTextDocument } from '../mocks/test-text-document';
import { createTestDir } from '../integration_helper';
import * as configModule from '../../configuration';
import * as csExtensionState from '../../cs-extension-state';
import { AgentRefactoringService } from '../../refactoring/agent-service';
import { FnToRefactor } from '../../devtools-api/refactor-models';

import { aceSuite } from '../ace-test-suite';

aceSuite('Agent Integration Test Suite', () => {
  const testDir = createTestDir('test-agent-integration');
  const testToken = process.env.CODESCENE_TEST_TOKEN;
  let originalGetAuthToken: any;
  let originalGetExtensionPath: any;

  if (!testToken) {
    console.log('Skipping Agent Integration tests: CODESCENE_TEST_TOKEN environment variable not set');
    return;
  }

  const projectRoot = path.join(__dirname, '..', '..', '..');
  const agentBinaryPath = path.join(projectRoot, 'bin', 'cs-agent');
  if (!fs.existsSync(agentBinaryPath)) {
    console.log('Skipping Agent Integration tests: cs-agent binary not found at ' + agentBinaryPath);
    return;
  }

  function createTestFile(filename: string, content: string, languageId: string = 'cpp'): TestTextDocument {
    const testFile = path.resolve(testDir, filename);
    fs.writeFileSync(testFile, content);
    return new TestTextDocument(testFile, content, languageId);
  }

  setup(async function () {
    this.timeout(60000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    const { execSync } = require('child_process');
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@test.com"', { cwd: testDir });
    execSync('git config user.name "Test"', { cwd: testDir });

    mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);

    originalGetAuthToken = configModule.getAuthToken;
    (configModule as any).getAuthToken = () => testToken;

    originalGetExtensionPath = csExtensionState.getExtensionPath;
    (csExtensionState as any).getExtensionPath = () => projectRoot;

    Object.defineProperty(csExtensionState.CsExtensionState, 'stateProperties', {
      get: () => ({
        session: undefined,
        features: {
          analysis: { state: 'enabled' },
          ace: { state: 'enabled' },
        },
      }),
      configurable: true,
    });
  });

  teardown(() => {
    if (originalGetAuthToken) {
      (configModule as any).getAuthToken = originalGetAuthToken;
    }

    if (originalGetExtensionPath) {
      (csExtensionState as any).getExtensionPath = originalGetExtensionPath;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });

  test('runRefactoring returns valid response with code and confidence', async function () {
    this.timeout(120000);

    const complexContent = `int f(int a) {
  if (a > 0) {
    if (a > 1) {
      if (a > 2) {
        if (a > 3) {
          return a;
        }
      }
    }
  }
  return 0;
}
`;

    const doc = createTestFile('complex.cpp', complexContent);

    const fnToRefactor: FnToRefactor = {
      'file-type': 'cpp',
      name: 'f',
      body: complexContent,
      'refactoring-targets': [
        {
          category: 'Deep, Nested Complexity',
          line: 2,
        },
      ],
      range: {
        'start-line': 1,
        'start-column': 1,
        'end-line': 13,
        'end-column': 2,
      },
      vscodeRange: new vscode.Range(0, 0, 12, 1),
    };

    const response = await AgentRefactoringService.runRefactoring(doc, fnToRefactor);

    const inputFilePath = path.join(testDir, 'render-code-fix-input.json');
    const outputFilePath = path.join(testDir, 'render-code-fix-output.json');
    assert.ok(!fs.existsSync(inputFilePath), 'Input JSON file should NOT be in the repo directory');
    assert.ok(!fs.existsSync(outputFilePath), 'Output JSON file should NOT be in the repo directory');

    assert.ok(response, 'Response should be defined');
    assert.ok(response.code, 'Response should have code');
    assert.ok(response.confidence, 'Response should have confidence');
    assert.strictEqual(typeof response.confidence.level, 'number', 'Confidence level should be a number');
    assert.ok(response.confidence.title, 'Confidence should have a title');
    assert.ok(response.confidence['recommended-action'], 'Confidence should have recommended action');
    assert.ok(response['trace-id'], 'Response should have trace-id');
    assert.ok(response['refactoring-properties'], 'Response should have refactoring-properties');
  });

  test('runRefactoring writes JSON files to temp directory', async function () {
    this.timeout(120000);

    const simpleContent = `int g(int x) {
  if (x > 0) {
    if (x > 1) {
      if (x > 2) {
        return x;
      }
    }
  }
  return 0;
}
`;

    const doc = createTestFile('simple.cpp', simpleContent);

    const fnToRefactor: FnToRefactor = {
      'file-type': 'cpp',
      name: 'g',
      body: simpleContent,
      'refactoring-targets': [
        {
          category: 'Deep, Nested Complexity',
          line: 2,
        },
      ],
      range: {
        'start-line': 1,
        'start-column': 1,
        'end-line': 11,
        'end-column': 2,
      },
      vscodeRange: new vscode.Range(0, 0, 10, 1),
    };

    for (const dir of fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('cs-agent-io-'))) {
      fs.rmSync(path.join(os.tmpdir(), dir), { recursive: true });
    }

    await AgentRefactoringService.runRefactoring(doc, fnToRefactor, undefined, true);

    const tmpDirsAfter = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('cs-agent-io-'));
    assert.strictEqual(tmpDirsAfter.length, 1, 'Exactly one temp directory should exist');

    const ioDir = path.join(os.tmpdir(), tmpDirsAfter[0]);
    const inputFile = path.join(ioDir, 'render-code-fix-input.json');
    const outputFile = path.join(ioDir, 'render-code-fix-output.json');

    assert.ok(fs.existsSync(inputFile), 'Input JSON file should exist in temp directory');
    assert.ok(fs.existsSync(outputFile), 'Output JSON file should exist in temp directory');

    const inputContent = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    assert.ok(inputContent.task_id, 'Input file should contain task_id');
    assert.ok(inputContent.file, 'Input file should contain file path');
    assert.strictEqual(inputContent.smell, 'Deep, Nested Complexity', 'Input file should contain smell');

    const outputContent = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
    assert.ok(outputContent.fix_result, 'Output file should contain fix_result');
    assert.ok(outputContent.changes, 'Output file should contain changes');
    assert.strictEqual(
      outputContent.task_id,
      inputContent.task_id,
      'Output task_id should match input task_id (proves agent read from temp directory)'
    );
    if (outputContent.fix_result === 'fix_proposed') {
      assert.ok(outputContent.changes.length > 0, 'fix_proposed should have at least one change');
      const changedFiles = outputContent.changes.map((c: { file: string }) => c.file);
      assert.ok(
        changedFiles.some((f: string) => f.includes('simple.cpp')),
        `Changes should reference the input file (got: ${changedFiles.join(', ')})`
      );
    }

    fs.rmSync(ioDir, { recursive: true });
  });

  test('runRefactoring cleans up temp directory after completion', async function () {
    this.timeout(120000);

    const simpleContent = `int h(int x) {
  if (x > 0) {
    if (x > 1) {
      if (x > 2) {
        return x;
      }
    }
  }
  return 0;
}
`;

    const doc = createTestFile('cleanup.cpp', simpleContent);

    const fnToRefactor: FnToRefactor = {
      'file-type': 'cpp',
      name: 'h',
      body: simpleContent,
      'refactoring-targets': [
        {
          category: 'Deep, Nested Complexity',
          line: 2,
        },
      ],
      range: {
        'start-line': 1,
        'start-column': 1,
        'end-line': 11,
        'end-column': 2,
      },
      vscodeRange: new vscode.Range(0, 0, 10, 1),
    };

    for (const dir of fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('cs-agent-io-'))) {
      fs.rmSync(path.join(os.tmpdir(), dir), { recursive: true });
    }

    await AgentRefactoringService.runRefactoring(doc, fnToRefactor);

    const tmpDirsAfter = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('cs-agent-io-'));
    assert.strictEqual(tmpDirsAfter.length, 0, 'Temp directory should be cleaned up after refactoring');
  });
});
