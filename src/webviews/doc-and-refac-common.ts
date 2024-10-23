import { readFileSync } from 'fs';
import { join } from 'path';
import vscode, { Uri, Webview, WebviewPanel } from 'vscode';
import { categoryToDocsCode } from '../documentation/csdoc-provider';
import { isDefined } from '../utils';
import { getUri, nonce } from './utils';

interface HtmlTemplateParams {
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
export function renderHtmlTemplate(webViewPanel: WebviewPanel, extensionUri: Uri, params: HtmlTemplateParams) {
  const { title, bodyContent, cssPaths, scriptPaths } = params;
  // out/webviews/doc-and-refac-common-webview-script.ts
  webViewPanel.title = title;

  const webView = webViewPanel.webview;

  const cssTags = [];
  cssTags.push(
    cssTag(webView, extensionUri, ['out', 'webviews', 'doc-and-refac-common.css']),
    cssTag(webView, extensionUri, ['assets', 'markdown-languages.css']),
    cssTag(webView, extensionUri, ['assets', 'highlight.css']),
    cssTag(webView, extensionUri, ['out', 'codicons', 'codicon.css'])
  );

  cssPaths?.forEach((path) => cssTags.push(cssTag(webView, extensionUri, path)));

  const scriptTags = [scriptTag(webView, extensionUri, ['out', 'webviews', 'doc-and-refac-common-webview-script.js'])];
  scriptPaths?.forEach((path) => scriptTags.push(scriptTag(webView, extensionUri, path)));

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
        <h2 class="cs-common">${title}</h2>
        ${Array.isArray(bodyContent) ? bodyContent.join('\n') : bodyContent}
    </body>

    </html>
    `;
  webView.html = html;
}

function cssTag(webView: Webview, extensionUri: Uri, pathComponents: string[]) {
  const uri = getUri(webView, extensionUri, ...pathComponents);
  return /*html*/ `
        <link href="${uri}" type="text/css" rel="stylesheet" />
    `;
}

function scriptTag(webView: Webview, extensionUri: Uri, pathComponents: string[]) {
  const uri = getUri(webView, extensionUri, ...pathComponents);
  return /*html*/ `
    <script type="module" nonce="${nonce()}" src="${uri}"></script>
  `;
}

/**
 * Note - need to implement expanding collapsing toggle in each webview script,
 * connected to the corresponding "title" (lowercased)
 *
 * @param title
 * @param containerContent
 * @returns
 */
export function collapsibleContent(title: string, containerContent?: string) {
  if (!isDefined(containerContent)) return '';

  const classCompatibleTitle = title.toLowerCase().replace(/ /g, '-');

  return /*html*/ `
    <h3 data-cs-type="collapsible-header"
        data-cs-title="${classCompatibleTitle}" 
        class="${classCompatibleTitle}-header clickable">
      <span class="codicon codicon-chevron-down expand-indicator"></span>
      ${title}
    </h3>
    <div data-cs-type="collapsible-container" 
         data-cs-title="${classCompatibleTitle}" 
         class="container ${classCompatibleTitle}-container">
      ${containerContent}
    </div>
`;
}

export function readRawMarkdownDocs(category: string, docPath: string, extensionUri: Uri) {
  const docsPath = categoryToDocsCode(category);
  const path = join(extensionUri.fsPath, 'docs', docPath, `${docsPath}.md`);
  return readFileSync(path).toString().trim();
}

export async function renderedSegment(title: string, markdown?: string) {
  if (!markdown) return '';
  const html = await vscode.commands.executeCommand<string>('markdown.api.render', markdown.trim());
  return collapsibleContent(title, html);
}
