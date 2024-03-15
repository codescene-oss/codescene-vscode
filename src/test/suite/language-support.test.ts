import * as assert from 'assert';
import { toRefactoringDocumentSelector } from '../../language-support';
import { RefactoringSupport } from '../../refactoring/model';

suite('Language support test suite', () => {
  const support: RefactoringSupport = { 'code-smells': [], 'file-types': ['js', 'mjs', 'jsx', 'mm'] };

  test('Create DocumentSelector from supported file-types', () => {
    const selector = toRefactoringDocumentSelector(support['file-types']);
    /*
     * Assert that we only have one 'javascript' language (although we have multiple js file-types)
     * and that we have both 'objective-c' and 'objective-cpp' language support
     */
    assert.strictEqual(
      JSON.stringify(selector),
      '[{"language":"javascript","scheme":"file"},{"language":"javascriptreact","scheme":"file"},{"language":"objective-c","scheme":"file"},{"language":"objective-cpp","scheme":"file"}]'
    );
  });
});
