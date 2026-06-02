import * as assert from 'assert';
import {
  generateContextScriptTag,
  getCsp,
  initBaseContent,
  initialDataContextScriptTag,
} from '../../centralized-webview-framework/cwf-html-utils';
import { CsExtensionState } from '../../cs-extension-state';

suite('cwf-html-utils Test Suite', () => {
  const fakeWebview = {
    cspSource: 'vscode-resource:',
    asWebviewUri: (uri: any) => uri.toString(),
  } as any;

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

  test('initBaseContent produces valid HTML with nonce and CSP', () => {
    // Set up CsExtensionState with a fake extensionUri
    (CsExtensionState as any)._instance = { extensionUri: { toString: () => '/ext' } };

    const html = initBaseContent(fakeWebview, {} as any);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('Content-Security-Policy'));
    assert.ok(html.includes("default-src 'none';"));
    assert.ok(/nonce="[A-Za-z0-9]+"/.test(html));
    // Verify nonce is consistent across script tags
    const nonces = html.match(/nonce="([A-Za-z0-9]+)"/g)!;
    assert.ok(nonces.length >= 2);
    assert.strictEqual(nonces[0], nonces[1]);
  });
});
