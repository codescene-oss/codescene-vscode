import * as assert from 'assert';
import { reasonsContent } from '../../codescene-tab/webview/refactoring-components';
import { RefactorResponse } from '../../refactoring/model';

const code = 'function foo() {}\n';

suite('Refactor panel components Test Suite', () => {
  test('Expected reasons for conf 0', async () => {
    const response: RefactorResponse = {
      code,
      'reasons-with-details': [{ summary: 'summary' }],
      'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
      confidence: {
        description: 'no-confidence',
        level: 0,
        title: 'Refactoring results',
        'recommended-action': {
          description: 'Unverified refactoring',
          details: 'LLMs failed to identify a sufficiently effective refactoring.',
        },
        'review-header': 'Reason for unverified refactoring',
      },
      metadata: {},
    };
    const content = reasonsContent(response);
    assert.match(
      content,
      /The LLMs couldn't provide an ideal refactoring due to the specific complexities of the code. Though not an endorsed solution, it is displayed as a guide to help refine your approach./
    );
  });

  test('Expected reasons for full conf (4), with no reasons(-with-details)', async () => {
    const response: RefactorResponse = {
      code,
      'reasons-with-details': [],
      'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
      confidence: {
        description: 'full-confidence',
        level: 4,
        title: 'Refactoring suggestion',
        'recommended-action': {
          description: 'Quick inspection',
          details: 'The refactoring improves code health and preserves the semantics of the code.',
        },
        'review-header': 'Refactoring notes',
      },
      metadata: {},
    };
    const content = reasonsContent(response);
    assert.equal(content, '');
  });
});
