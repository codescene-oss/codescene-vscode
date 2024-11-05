import assert from 'assert';
import * as vscode from 'vscode';
import { RefactoringCapabilities } from '../../refactoring/capabilities';
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
    dreamberd: {
      'code-smells': ['Bad Naming', 'Bumpy Road Ahead', 'Large Method'],
    },
  },

  // Old props
  supported: {
    'code-smells': [],
    'file-types': [],
  },
  'max-input-loc': 130,
  'max-input-tokens': 2048,
};

const capabilities = new RefactoringCapabilities(preFlight);

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

    test('Supported code smells for specific languageIds', async () => {
      let support = capabilities.isSupported('Complex Method', { languageId: 'javascript' } as any);
      assert.strictEqual(support, true, 'Complex Method should be supported for js');
      support = capabilities.isSupported('Bad Naming', { languageId: 'javascript' } as any);
      assert.strictEqual(support, true, 'Unsupported code smell should return false for js');

      support = capabilities.isSupported('Complex Method', { languageId: 'dreamberd' } as any);
      assert.strictEqual(support, false, 'Complex Method is not supported for dreamberd');
      support = capabilities.isSupported('Bad Naming', { languageId: 'dreamberd' } as any);
      assert.strictEqual(support, true, '"Bad Naming" smell is supported for dreamberd');
    });
  });

  test('Get max-loc-limit for documents', () => {
    const jsDocument = { languageId: 'javascript' };
    const javaDocument = { languageId: 'java' };

    assert.strictEqual(capabilities.maxLocFor(jsDocument as any), 130, 'Max loc for js should be 130');
    assert.strictEqual(capabilities.maxLocFor(javaDocument as any), 200, 'Max loc for java should be 200');
  });
});
