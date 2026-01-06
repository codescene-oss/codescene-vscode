import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { CodeHealthRulesResult } from '../../devtools-api/model';
import { createTestDir, ensureBinary } from '../integration_helper';

suite('Check Rules Test Suite', () => {
  const testDir = createTestDir('test-check-rules');
  const codeSceneDir = path.join(testDir, '.codescene');
  const rulesFile = path.join(codeSceneDir, 'code-health-rules.json');

  async function createRulesFile(content: string) {
    if (!fs.existsSync(codeSceneDir)) {
      fs.mkdirSync(codeSceneDir, { recursive: true });
    }
    fs.writeFileSync(rulesFile, content);
  }

  async function createTestFile(filename: string, content: string): Promise<string> {
    const testFile = path.join(testDir, filename);
    fs.writeFileSync(testFile, content);
    return testFile;
  }

  async function checkRules(filename: string): Promise<CodeHealthRulesResult> {
    return await DevtoolsAPI.checkRules(testDir, filename);
  }

  setup(async function() {
    this.timeout(60000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    const { execSync } = require('child_process');
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });

    mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);

    const binaryPath = await ensureBinary();
    const mockContext = createMockExtensionContext(testDir);

    DevtoolsAPI.init(binaryPath, mockContext);
  });

  teardown(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });

  test('checkRules returns result with no custom rules', async function() {
    this.timeout(10000);

    const testFile = await createTestFile('test.cpp', 'int main() { return 0; }\n');
    const result = await checkRules(testFile);

    assert.ok(result, 'Result should exist');
    assert.ok(typeof result.rulesMsg === 'string', 'rulesMsg should be a string');
    assert.ok(result.rulesMsg.includes('No matching rule found'), 'Should indicate no matching rule');
  });

  test('checkRules returns result for file with custom rules', async function() {
    this.timeout(10000);

    const template = await DevtoolsAPI.codeHealthRulesTemplate();
    await createRulesFile(template);

    const testFile = await createTestFile('example.cpp', 'int add(int a, int b) { return a + b; }\n');
    const result = await checkRules(testFile);

    assert.ok(result, 'Result should exist');
    assert.ok(typeof result.rulesMsg === 'string', 'rulesMsg should be a string');
    assert.ok(result.rulesMsg.includes('Matching code health rule path:'), 'Should indicate matching rule path');
    assert.ok(result.rulesMsg.includes('Rule found in file:'), 'Should indicate rule file location');
  });

  test('checkRules handles different file types', async function() {
    this.timeout(10000);

    const template = await DevtoolsAPI.codeHealthRulesTemplate();
    await createRulesFile(template);

    const jsFile = await createTestFile('test.js', 'function foo() { return 42; }\n');
    const jsResult = await checkRules(jsFile);

    assert.ok(jsResult, 'JavaScript file result should exist');
    assert.ok(typeof jsResult.rulesMsg === 'string', 'rulesMsg should be a string');

    const pyFile = await createTestFile('test.py', 'def bar():\n    return 1\n');
    const pyResult = await checkRules(pyFile);

    assert.ok(pyResult, 'Python file result should exist');
    assert.ok(typeof pyResult.rulesMsg === 'string', 'rulesMsg should be a string');
  });

  test('checkRules with custom rules matching specific paths', async function() {
    this.timeout(10000);

    const customRules = {
      usage: 'Custom rules for testing',
      rule_sets: [
        {
          'matching-content-path': '**/*.cpp',
          thresholds: [
            {
              name: 'function_cyclomatic_complexity_warning',
              value: '5'
            }
          ]
        }
      ]
    };

    await createRulesFile(JSON.stringify(customRules, null, 2));

    const cppFile = await createTestFile('complex.cpp',
      'int f(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      return a;\n    }\n  }\n  return 0;\n}\n'
    );
    const result = await checkRules(cppFile);

    assert.ok(result, 'Result should exist');
    assert.ok(typeof result.rulesMsg === 'string', 'rulesMsg should be a string');
    assert.ok(result.rulesMsg.includes('Matching code health rule path: **/*.cpp'), 'Should match cpp-specific path pattern');
  });

  test('checkRules returns errorMsg when rules file is invalid', async function() {
    this.timeout(10000);

    await createRulesFile('{ invalid json');

    const testFile = await createTestFile('test.cpp', 'int main() { return 0; }\n');
    const result = await checkRules(testFile);

    assert.ok(result, 'Result should exist');
    assert.ok(typeof result.rulesMsg === 'string', 'rulesMsg should be a string');
    assert.ok(result.errorMsg !== undefined, 'errorMsg should be present for invalid rules');
    assert.ok(result.errorMsg.includes('Problem in ruleset:'), 'Should indicate problem in ruleset');
    assert.ok(result.errorMsg.includes('Failed to parse the code health rule set'), 'Should mention parsing failure');
  });

  test('checkRules result structure is valid', async function() {
    this.timeout(10000);

    const template = await DevtoolsAPI.codeHealthRulesTemplate();
    await createRulesFile(template);

    const testFile = await createTestFile('test.c', 'void foo() {}\n');
    const result = await checkRules(testFile);

    assert.ok('rulesMsg' in result, 'Result should have rulesMsg property');
    assert.ok(typeof result.rulesMsg === 'string', 'rulesMsg should be a string');

    if (result.errorMsg !== undefined) {
      assert.ok(typeof result.errorMsg === 'string', 'errorMsg should be a string if present');
    }
  });
});
