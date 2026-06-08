import * as assert from 'assert';
import { collapsibleContent, functionLocationContent } from '../../codescene-tab/webview/components';

suite('Webview components HTML escaping', () => {
  suite('collapsibleContent', () => {
    test('escapes title when content is provided', () => {
      const html = collapsibleContent('<img src=x>', '<div>body</div>');
      assert.ok(html.includes('&lt;img src=x&gt;'));
      // body content is intentionally passed through as raw HTML
      assert.ok(html.includes('<div>body</div>'));
    });

    test('returns empty string when content is undefined', () => {
      assert.strictEqual(collapsibleContent('Title', undefined), '');
    });

    test('renders header with classCompatibleTitle derived from raw title', () => {
      const html = collapsibleContent('My Title', '<div></div>');
      assert.ok(html.includes('data-cs-title="my-title"'));
      assert.ok(html.includes('class="my-title-header clickable"'));
    });

    test('applies collapsed/rotated classes when isCollapsed is true', () => {
      const html = collapsibleContent('Title', '<div></div>', true);
      assert.ok(html.includes('rotated'));
      assert.ok(html.includes('collapsed'));
    });
  });

  suite('functionLocationContent', () => {
    test('escapes fnName', () => {
      const html = functionLocationContent({
        filePath: '/repo/src/file.ts',
        fnName: '<script>alert(1)</script>',
      });
      assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
      assert.ok(!html.includes('<script>alert'));
    });

    test('escapes basename of filePath', () => {
      const html = functionLocationContent({
        filePath: '/repo/<img src=x>.ts',
      });
      assert.ok(html.includes('&lt;img src=x&gt;.ts'));
      assert.ok(!html.includes('<img src=x>.ts'));
    });

    test('omits fnName block when fnName is undefined', () => {
      const html = functionLocationContent({ filePath: '/repo/file.ts' });
      assert.ok(html.includes('file.ts'));
      assert.ok(!html.includes('codicon-symbol-method'));
    });

    test('renders line number when position is provided', () => {
      const html = functionLocationContent({
        filePath: '/repo/file.ts',
        position: { line: 9, character: 0 } as any,
      });
      assert.ok(html.includes('[Ln 10]'));
    });

    test('applies strikeout class when isStale is true', () => {
      const html = functionLocationContent({
        filePath: '/repo/file.ts',
        fnName: 'foo',
        isStale: true,
      });
      assert.ok(html.includes('strikeout'));
    });
  });
});
