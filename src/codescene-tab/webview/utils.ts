import { readFileSync } from 'fs';
import { join } from 'path';
import { Webview, WebviewPanel } from 'vscode';
import { CsExtensionState } from '../../cs-extension-state';
import { categoryToDocsCode } from '../../documentation/commands';
import { getUri, nonce } from '../../webview-utils';

export interface HtmlTemplateParams {
  title: string;
  bodyContent: string | string[];
  cssPaths?: string[][];
  scriptPaths?: string[][];
}

/**
 * Template for documentation and refactoring panel
 * @param title
 * @param bodyContent
 */
export function renderHtmlTemplate(webViewPanel: WebviewPanel, params: HtmlTemplateParams) {
  const { title, bodyContent, cssPaths, scriptPaths } = params;
  // out/webviews/doc-and-refac-common-webview-script.ts
  webViewPanel.title = title;

  const webView = webViewPanel.webview;

  const cssTags = [];
  cssTags.push(
    cssTag(webView, ['assets', 'markdown-languages.css']),
    cssTag(webView, ['assets', 'highlight.css']),
    cssTag(webView, ['out', 'codescene-tab', 'webview', 'styles.css']),
    cssTag(webView, ['out', 'codicons', 'codicon.css'], 'vscode-codicon-stylesheet') // NOTE - vscode-elements needs an id for the stylesheet tag ¯\_(ツ)_/¯
  );

  cssPaths?.forEach((path) => cssTags.push(cssTag(webView, path)));

  const scriptTags = [scriptTag(webView, ['out', 'codescene-tab', 'webview', 'script.js'])];
  scriptPaths?.forEach((path) => scriptTags.push(scriptTag(webView, path)));

  // Note, the html "typehint" is used by the es6-string-html extension to enable highlighting of the html-string
  const html = /*html*/ `
    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src data: ${webView.cspSource}; script-src ${webView.cspSource}; font-src ${
    webView.cspSource
  };
          style-src 'unsafe-inline' ${webView.cspSource};"
        />
        ${cssTags.join('\n')}
    </head>

    <body>
        ${scriptTags.join('\n')}
        <h2>${title}</h2>
        ${Array.isArray(bodyContent) ? bodyContent.join('\n') : bodyContent}
    </body>

    </html>
    `;
  webView.html = html;
}

function cssTag(webView: Webview, pathComponents: string[], id?: string) {
  const uri = getUri(webView, ...pathComponents);
  return /*html*/ `
        <link href="${uri}" type="text/css" rel="stylesheet" ${id ? 'id="' + id + '"' : ''}/>
    `;
}

function scriptTag(webView: Webview, pathComponents: string[]) {
  const uri = getUri(webView, ...pathComponents);
  return /*html*/ `
    <script type="module" nonce="${nonce()}" src="${uri}"></script>
  `;
}

export function readRawMarkdownDocs(category: string, docPath: string) {
  const docsPath = categoryToDocsCode(category);
  const path = join(CsExtensionState.extensionUri.fsPath, 'docs', docPath, `${docsPath}.md`);
  return readFileSync(path).toString().trim();
}
