import * as assert from 'assert';
import { escapeHtml } from '../../codescene-tab/webview/utils';

suite('escapeHtml', () => {
  test('escapes ampersands', () => {
    assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
  });

  test('escapes less-than', () => {
    assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
  });

  test('escapes greater-than', () => {
    assert.strictEqual(escapeHtml('a > b'), 'a &gt; b');
  });

  test('escapes double quotes', () => {
    assert.strictEqual(escapeHtml('"hello"'), '&quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    assert.strictEqual(escapeHtml("it's"), 'it&#039;s');
  });

  test('escapes all special characters together', () => {
    assert.strictEqual(
      escapeHtml('<img src="x" onerror=\'alert(&)\'>'),
      '&lt;img src=&quot;x&quot; onerror=&#039;alert(&amp;)&#039;&gt;'
    );
  });

  test('returns empty string unchanged', () => {
    assert.strictEqual(escapeHtml(''), '');
  });

  test('returns safe string unchanged', () => {
    assert.strictEqual(escapeHtml('hello world 123'), 'hello world 123');
  });
});
