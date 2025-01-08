import assert from 'assert';
import * as vscode from 'vscode';
import { DevtoolsAPI } from '../../devtools-interop/api';
import { EnclosingFn } from '../../devtools-interop/model';
import { rangeFromEnclosingFn, RefactoringCapabilities, targetsInRange } from '../../refactoring/capabilities';
import { PreFlightResponse } from '../../refactoring/model';

const preFlight: PreFlightResponse = {
  version: 2.0,
  'file-types': ['js', 'mjs', 'ts', 'jsx', 'tsx', 'java', 'mm'],
  'language-common': {
    'code-smells': [
      'Complex Conditional',
      'Bumpy Road Ahead',
      'Complex Method',
      'Deep, Nested Complexity',
      'Large Method',
    ],
    'max-input-loc': 130,
  },
  'language-specific': {
    java: {
      'max-input-loc': 200,
    },
    mm: {
      'code-smells': ['Bad Naming', 'Bumpy Road Ahead', 'Large Method'],
    },
  },
};

const capabilities = new RefactoringCapabilities(preFlight, new DevtoolsAPI('./cs-dummy'));

suite('Refactoring capabilities Test Suite', () => {
  test('Check DocumentSelector from supported file-types', () => {
    /*
     * Assert that we only have one 'javascript' language (although we have multiple js file-types)
     * and that we have both 'objective-c' and 'objective-cpp' language support
     */
    assert.strictEqual(
      JSON.stringify(capabilities.documentSelector),
      '[{"language":"javascript"},{"language":"typescript"},{"language":"javascriptreact"},{"language":"typescriptreact"},{"language":"java"},{"language":"objective-c"},{"language":"objective-cpp"}]'
    );
  });

  test('Document Selector Test', async () => {
    const jsDocument = await vscode.workspace.openTextDocument({ content: '', language: 'javascript' });
    const jsMatch = vscode.languages.match(capabilities.documentSelector, jsDocument);
    assert.strictEqual(jsMatch, 10, 'Document should match the selector');

    const cudaDocument = await vscode.workspace.openTextDocument({ content: '', language: 'cuda-cpp' });
    const cudaMatch = vscode.languages.match(capabilities.documentSelector, cudaDocument);
    assert.strictEqual(cudaMatch, 0, 'Document should not match the selector');
  });

  test('Supported code smells', () => {
    assert.strictEqual(capabilities.isSupported('Complex Method'), true, 'Complex Method should be supported');
    assert.strictEqual(capabilities.isSupported('Bad Naming'), false, 'Unsupported code smell should return false');
  });

  test('Supported code smells for specific languageIds', async () => {
    let support = capabilities.isSupported('Complex Method', { languageId: 'javascript' } as any);
    assert.strictEqual(support, true, 'Complex Method should be supported for js');
    support = capabilities.isSupported('Bad Naming', { languageId: 'javascript' } as any);
    assert.strictEqual(support, false, 'Unsupported code smell should return false for js');

    support = capabilities.isSupported('Complex Method', { languageId: 'objective-cpp' } as any);
    assert.strictEqual(support, false, 'Complex Method is not supported for objective-cpp');
    support = capabilities.isSupported('Bad Naming', { languageId: 'objective-cpp' } as any);
    assert.strictEqual(support, true, '"Bad Naming" smell is supported for objective-cpp');
  });

  test('Get max-loc-limit for documents', () => {
    const jsDocument = { languageId: 'javascript' };
    const javaDocument = { languageId: 'java' };

    assert.strictEqual(capabilities.maxLocFor(jsDocument as any), 130, 'Max loc for js should be 130');
    assert.strictEqual(capabilities.maxLocFor(javaDocument as any), 200, 'Max loc for java should be 200');
  });
});

const enclosingFn1: EnclosingFn = {
  name: 'anon',
  'start-line': 1,
  'end-line': 1,
  body: 'const a = () => {};',
  'function-type': 'FatArrrowFn',
  'start-column': 0,
  'end-column': 19,
  'active-code-size': 1,
};

const enclosingFn2: EnclosingFn = {
  name: 'notSoGoodXX',
  'start-line': 48,
  'end-line': 101,
  body: 'function notSoGoodXX(\n  intersects,\n  endRel,\n  startRel,\n  endX,\n  endY,\n  minX,\n  minY,\n  maxX,\n  maxY,\n  slope\n) {\n  if (\n    !intersects &&\n    !!(endRel & Relationship.RIGHT) &&\n    !(startRel & Relationship.RIGHT)\n  ) {\n    // potentially intersects right\n    y = endY - (endX - maxX) * slope;\n    intersects = y >= minY && y <= maxY;\n  }\n\n  switch (param.type) {\n    case "Identifier":\n      nodes.push(param);\n      break;\n\n    case "ObjectPattern":\n      for (const prop of param.properties) {\n        if (prop.type === "RestElement") {\n          extract_identifiers(prop.argument, nodes);\n        } else {\n          extract_identifiers(prop.value, nodes);\n        }\n      }\n\n      break;\n\n    case "ArrayPattern":\n      for (const element of param.elements) {\n        if (element) extract_identifiers(element, nodes);\n      }\n\n      break;\n\n    case "RestElement":\n      extract_identifiers(param.argument, nodes);\n      break;\n\n    case "AssignmentPattern":\n      extract_identifiers(param.left, nodes);\n      break;\n  }\n}',
  'function-type': 'StandaloneFn',
  'start-column': 0,
  'end-column': 1,
  'active-code-size': 54,
};

suite('Refactor capabilities helper Test Suite', () => {
  test('Range and codeSmell lines calculations for simple function', async () => {
    const enclosingFunctionRange = rangeFromEnclosingFn(enclosingFn1);
    assert.ok(enclosingFunctionRange.isEqual(new vscode.Range(0, 0, 0, 19)));

    const complexMethod = { line: 1, category: 'Complex Method' };
    const codeSmell = targetsInRange([complexMethod], enclosingFunctionRange)[0];
    assert.equal(codeSmell.relativeStartLine, 0);
    assert.equal(codeSmell.relativeEndLine, 0);
  });

  test('Range and codeSmell lines calculations with more complex relative lines', async () => {
    const enclosingFunctionRange = rangeFromEnclosingFn(enclosingFn2);
    assert.ok(enclosingFunctionRange.isEqual(new vscode.Range(47, 0, 100, 1)));

    const complexMethod = { line: 48, category: 'Complex Method' };
    const complexConditional = { line: 56, category: 'Complex Conditional' };
    const codeSmells = targetsInRange([complexMethod, complexConditional], enclosingFunctionRange);
    assert.equal(codeSmells[0].relativeStartLine, 0);
    assert.equal(codeSmells[0].relativeEndLine, 53);

    assert.equal(codeSmells[1].relativeStartLine, 8);
    assert.equal(codeSmells[1].relativeEndLine, 45);
  });
});
