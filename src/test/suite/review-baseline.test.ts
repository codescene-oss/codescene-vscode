import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { createTestDir, ensureBinary } from '../integration_helper';
import { TestTextDocument } from '../mocks/test-text-document';

suite('Review Baseline Test Suite', () => {
  const testDir = createTestDir('test-review-baseline');

  function createTestFile(filename: string, content: string): TestTextDocument {
    const testFile = path.resolve(testDir, filename);
    fs.writeFileSync(testFile, content);
    return new TestTextDocument(testFile, content, 'cpp');
  }

  setup(async function() {
    this.timeout(60000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

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

  test('reviewBaseline returns undefined when file does not exist in baseline', async function() {
    this.timeout(10000);

    const initialContent = 'int main() { return 0; }\n';
    const testFile = path.join(testDir, 'initial.cpp');
    fs.writeFileSync(testFile, initialContent);

    execSync('git add initial.cpp', { cwd: testDir });
    execSync('git commit -m "Initial commit"', { cwd: testDir });
    const baselineCommit = execSync('git rev-parse HEAD', { cwd: testDir }).toString().trim();

    const newContent = 'int add(int a, int b) { return a + b; }\n';
    const newDoc = createTestFile('new.cpp', newContent);

    const result = await DevtoolsAPI.reviewBaseline(baselineCommit, newDoc);

    assert.deepStrictEqual(result, undefined);
  });

  test('reviewBaseline returns review when file exists in baseline', async function() {
    this.timeout(10000);

    const originalContent = 'int simple() { return 1; }\n';
    const testFile = path.join(testDir, 'test.cpp');
    fs.writeFileSync(testFile, originalContent);

    execSync('git add test.cpp', { cwd: testDir });
    execSync('git commit -m "Add test file"', { cwd: testDir });
    const baselineCommit = execSync('git rev-parse HEAD', { cwd: testDir }).toString().trim();

    const updatedContent = 'int simple() { return 2; }\n';
    const doc = createTestFile('test.cpp', updatedContent);

    const result = await DevtoolsAPI.reviewBaseline(baselineCommit, doc);

    assert.ok(result);
    const { 'raw-score': _, ...resultWithoutRawScore } = result;
    assert.deepStrictEqual(resultWithoutRawScore, {
      'file-level-code-smells': [],
      'function-level-code-smells': [],
      score: 10
    });
  });

  test('reviewBaseline handles commit with complex code', async function() {
    this.timeout(10000);

    const complexContent = 'int complex(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        return a;\n      }\n    }\n  }\n  return 0;\n}\n';
    const testFile = path.join(testDir, 'complex.cpp');
    fs.writeFileSync(testFile, complexContent);

    execSync('git add complex.cpp', { cwd: testDir });
    execSync('git commit -m "Add complex file"', { cwd: testDir });
    const baselineCommit = execSync('git rev-parse HEAD', { cwd: testDir }).toString().trim();

    const updatedContent = 'int complex(int a) {\n  if (a > 0) {\n    if (a > 1) {\n      if (a > 2) {\n        if (a > 3) {\n          return a;\n        }\n      }\n    }\n  }\n  return 0;\n}\n';
    const doc = createTestFile('complex.cpp', updatedContent);

    const result = await DevtoolsAPI.reviewBaseline(baselineCommit, doc);

    assert.ok(result);
    const { 'raw-score': _, ...resultWithoutRawScore } = result;
    assert.deepStrictEqual(resultWithoutRawScore, {
      'file-level-code-smells': [],
      'function-level-code-smells': [],
      score: 10
    });
  });

  test('reviewBaseline returns undefined for invalid commit', async function() {
    this.timeout(10000);

    const content = 'int foo() { return 42; }\n';
    const doc = createTestFile('test.cpp', content);

    const result = await DevtoolsAPI.reviewBaseline('invalid-commit-sha', doc);

    assert.deepStrictEqual(result, undefined);
  });

  test('reviewBaseline works with HEAD reference', async function() {
    this.timeout(10000);

    const originalContent = 'int getValue() { return 100; }\n';
    const testFile = path.join(testDir, 'value.cpp');
    fs.writeFileSync(testFile, originalContent);

    execSync('git add value.cpp', { cwd: testDir });
    execSync('git commit -m "Add value file"', { cwd: testDir });

    const updatedContent = 'int getValue() { return 200; }\n';
    const doc = createTestFile('value.cpp', updatedContent);

    const result = await DevtoolsAPI.reviewBaseline('HEAD', doc);

    assert.ok(result);
    const { 'raw-score': _, ...resultWithoutRawScore } = result;
    assert.deepStrictEqual(resultWithoutRawScore, {
      'file-level-code-smells': [],
      'function-level-code-smells': [],
      score: 10
    });
  });

  test('reviewBaseline returns file-level code smells for large file', async function() {
    this.timeout(10000);

    const largeContent = Array(1001).fill('int dummy() { return 0; }\n').join('');
    const testFile = path.join(testDir, 'large.cpp');
    fs.writeFileSync(testFile, largeContent);

    execSync('git add large.cpp', { cwd: testDir });
    execSync('git commit -m "Add large file"', { cwd: testDir });
    const baselineCommit = execSync('git rev-parse HEAD', { cwd: testDir }).toString().trim();

    const updatedContent = largeContent + 'int extra() { return 1; }\n';
    const doc = createTestFile('large.cpp', updatedContent);

    const result = await DevtoolsAPI.reviewBaseline(baselineCommit, doc);

    assert.ok(result);
    const { 'raw-score': _, 'file-level-code-smells': fileSmells, ...resultRest } = result;
    assert.strictEqual(fileSmells.length, 1);
    assert.deepStrictEqual(fileSmells[0], {
      category: 'Number of Functions in a Single Module',
      'highlight-range': {
        'start-line': 1,
        'start-column': 1,
        'end-line': 1,
        'end-column': 1
      },
      details: ''
    });
    assert.deepStrictEqual(resultRest, {
      'function-level-code-smells': [],
      score: 9.09
    });
  });

  test('reviewBaseline returns function-level code smells for complex function', async function() {
    this.timeout(10000);

    const veryComplexContent = `int veryComplex(int a, int b, int c, int d, int e, int f, int g) {
  if (a > 0) {
    if (b > 0) {
      if (c > 0) {
        if (d > 0) {
          if (e > 0) {
            if (f > 0) {
              if (g > 0) {
                return a + b + c + d + e + f + g;
              }
            }
          }
        }
      }
    }
  }
  return 0;
}
`;
    const testFile = path.join(testDir, 'verycomplex.cpp');
    fs.writeFileSync(testFile, veryComplexContent);

    execSync('git add verycomplex.cpp', { cwd: testDir });
    execSync('git commit -m "Add very complex file"', { cwd: testDir });
    const baselineCommit = execSync('git rev-parse HEAD', { cwd: testDir }).toString().trim();

    const updatedContent = veryComplexContent + 'int simple() { return 1; }\n';
    const doc = createTestFile('verycomplex.cpp', updatedContent);

    const result = await DevtoolsAPI.reviewBaseline(baselineCommit, doc);

    assert.ok(result);
    const { 'raw-score': _, 'function-level-code-smells': functionSmells, ...resultRest } = result;
    assert.strictEqual(functionSmells.length, 1);
    assert.deepStrictEqual(functionSmells[0], {
      function: 'veryComplex',
      range: {
        'start-line': 1,
        'start-column': 1,
        'end-line': 18,
        'end-column': 2
      },
      'code-smells': [
        {
          category: 'Deep, Nested Complexity',
          'highlight-range': {
            'start-line': 1,
            'start-column': 5,
            'end-line': 1,
            'end-column': 16
          },
          details: 'Nesting depth = 7 conditionals'
        },
        {
          category: 'Excess Number of Function Arguments',
          'highlight-range': {
            'start-line': 1,
            'start-column': 5,
            'end-line': 1,
            'end-column': 16
          },
          details: 'Arguments = 7'
        }
      ]
    });
    assert.deepStrictEqual(resultRest, {
      'file-level-code-smells': [],
      score: 8.81
    });
  });
});
