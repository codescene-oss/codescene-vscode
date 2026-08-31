import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
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

    assert.ok(response, 'Response should be defined');
    assert.ok(response.code, 'Response should have code');
    assert.ok(response.confidence, 'Response should have confidence');
    assert.strictEqual(typeof response.confidence.level, 'number', 'Confidence level should be a number');
    assert.ok(response.confidence.title, 'Confidence should have a title');
    assert.ok(response.confidence['recommended-action'], 'Confidence should have recommended action');
    assert.ok(response['trace-id'], 'Response should have trace-id');
    assert.ok(response['refactoring-properties'], 'Response should have refactoring-properties');
  });
});
