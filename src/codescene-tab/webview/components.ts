import { basename } from 'path';
import { commands, Position } from 'vscode';
import { isDefined } from '../../utils';

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

export function functionLocationContent({
  position,
  filePath,
  fnName,
}: {
  position: Position;
  filePath: string;
  fnName?: string;
}) {
  const fileName = basename(filePath);

  const fnNameHtml = fnName
    ? `<span class="codicon codicon-symbol-method"></span>
      ${fnName}`
    : '';

  return /*html*/ `
    <div id="function-location" class="flex-row">
      <span class="file-name">${fileName}</span>
      ${fnNameHtml}
      <span class="line-no">[Ln ${position.line + 1}]</span>
    </div>
    <hr>
    `;
}

export async function markdownAsCollapsible(title: string, markdown?: string) {
  if (!markdown) return '';
  const html = await commands.executeCommand<string>('markdown.api.render', markdown.trim());
  return collapsibleContent(title, html);
}
