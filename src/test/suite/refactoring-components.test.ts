import * as assert from 'assert';
import { reasonsContent } from '../../codescene-tab/webview/refactoring-components';
import { RefactorResponse } from '../../devtools-api/refactor-models';

const code = 'function foo() {}\n';

suite('Refactor panel components Test Suite', () => {
  test('Expected reasons for full conf (4), with no reasons(-with-details)', async () => {
    const response: RefactorResponse = {
      code,
      reasons: [],
      'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
      confidence: {
        level: 4,
        title: 'Refactoring suggestion',
        'recommended-action': {
          description: 'Quick inspection',
          details: 'The refactoring improves code health and preserves the semantics of the code.',
        },
        'review-header': 'Refactoring notes',
      },
      metadata: {},
      'trace-id': 'trace-id',
    };
    const content = reasonsContent(response);
    assert.equal(content, '');
  });
});
