import * as assert from 'assert';
import { reasonsContent, summaryDetails, summaryHeader } from '../../codescene-tab/webview/refactoring-components';
import { RefactorResponse } from '../../devtools-api/refactor-models';

const code = 'function foo() {}\n';

import { aceSuite } from '../ace-test-suite';

aceSuite('Refactor panel components Test Suite', () => {
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

  suite('summaryHeader HTML escaping', () => {
    test('escapes action text for low confidence', () => {
      const html = summaryHeader(1, 'level-1', '<img src=x onerror=alert(1)>');
      assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
      assert.ok(!html.includes('<img'));
    });

    test('returns hardcoded text for high confidence (no interpolation)', () => {
      const html = summaryHeader(4, 'level-4', '<script>evil</script>');
      assert.ok(html.includes('Refactoring improves Code Health'));
      assert.ok(!html.includes('<script>evil'));
    });
  });

  suite('summaryDetails HTML escaping', () => {
    test('escapes actionDetails for level -2', () => {
      const html = summaryDetails(-2, '<img src=x>');
      assert.strictEqual(html, '<span>&lt;img src=x&gt;</span>');
    });

    test('returns fixed message for level 0 (no interpolation)', () => {
      const html = summaryDetails(0, '<script>evil</script>');
      assert.ok(html.includes('The LLM failed to improve Code Health'));
      assert.ok(!html.includes('<script>'));
    });

    test('escapes actionDetails for level 1-2', () => {
      const html = summaryDetails(2, '"quoted" & <tag>');
      assert.strictEqual(html, '<span>&quot;quoted&quot; &amp; &lt;tag&gt;</span>');
    });

    test('returns empty string for level >= 3', () => {
      const html = summaryDetails(3, '<img src=x>');
      assert.strictEqual(html, '');
    });
  });

  suite('reasonsContent HTML escaping', () => {
    test('escapes reason.summary in list items', () => {
      const response: RefactorResponse = {
        code,
        reasons: [{ summary: '<script>alert(1)</script>' }],
        'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
        confidence: {
          level: 2,
          title: 'Refactoring suggestion',
          'recommended-action': { description: 'Inspect', details: 'Inspect' },
          'review-header': 'Reasons',
        },
        metadata: {},
        'trace-id': 'trace-id',
      };
      const html = reasonsContent(response);
      assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
      assert.ok(!html.includes('<script>alert'));
    });
  });
});
