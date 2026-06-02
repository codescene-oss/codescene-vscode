import * as assert from 'assert';
import {
  generateContextScriptTag,
  getCsp,
  initialDataContextScriptTag,
} from '../../centralized-webview-framework/cwf-html-utils';

suite('cwf-html-utils Test Suite', () => {
  const fakeWebview = { cspSource: 'vscode-resource:' } as any;

  test('getCsp uses provided nonce and restrictive directives', () => {
    const csp = getCsp(fakeWebview, 'abc123');
    assert.deepStrictEqual(csp, [
      `default-src 'none';`,
      `script-src vscode-resource: 'nonce-abc123'`,
      `style-src vscode-resource: 'unsafe-inline'`,
      `img-src vscode-resource: data:`,
      `font-src vscode-resource:`,
      `connect-src vscode-resource:`,
    ]);
  });

  test('initialDataContextScriptTag escapes HTML-sensitive characters and applies nonce', () => {
    const html = initialDataContextScriptTag({ payload: '</script><img src=x>&' } as any, 'n1');
    assert.ok(html.includes('<script nonce="n1">'));
    assert.ok(html.includes('\\u003c/script\\u003e\\u003cimg src=x\\u003e\\u0026'));
    assert.ok(!html.includes('</script><img'));
  });

  test('generateContextScriptTag escapes HTML-sensitive characters and applies nonce', () => {
    const html = generateContextScriptTag({ payload: '<&>' } as any, 'n2');
    assert.ok(html.includes('<script nonce="n2">'));
    assert.ok(html.includes('\\u003c\\u0026\\u003e'));
  });
});
