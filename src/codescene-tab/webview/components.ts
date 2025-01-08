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
export function collapsibleContent(title: string, containerContent?: string, isCollapsed = false) {
  if (!isDefined(containerContent)) return '';

  const classCompatibleTitle = title.toLowerCase().replace(/ /g, '-');

  return /*html*/ `
    <h3 data-cs-type="collapsible-header"
        data-cs-title="${classCompatibleTitle}" 
        class="${classCompatibleTitle}-header clickable">
      <span class="codicon codicon-chevron-down expand-indicator ${isCollapsed ? 'rotated' : ''}"></span>
      ${title}
    </h3>
    <div data-cs-type="collapsible-container" 
         data-cs-title="${classCompatibleTitle}" 
         class="container ${classCompatibleTitle}-container ${isCollapsed ? 'collapsed' : ''}">
      ${containerContent}
    </div>
`;
}

export function functionLocationContent({
  position,
  filePath,
  fnName,
  isStale,
}: {
  position: Position;
  filePath: string;
  fnName?: string;
  isStale?: boolean;
}) {
  const fileName = basename(filePath);

  const fnNameHtml = fnName
    ? `<span class="codicon codicon-symbol-method"></span>
       <span class="${isStale ? 'strikeout' : ''}">${fnName}</span>`
    : '';

  return /*html*/ `
    <div id="function-location" class="flex-row">
      <span class="codicon codicon-file"></span><span class="file-name">${fileName}</span>
      ${fnNameHtml}
      <span class="line-no ${isStale ? 'strikeout' : ''}">[Ln ${position.line + 1}]</span>
    </div>
    <hr>
    `;
}

export function fileChangesDetectedContent(description: string) {
  return /*html*/ `
    <div class="file-changes-detected">
      <div class="codicon codicon-warning warning-icon"></div>
      <div class="content">
        <div class="header">File Changes Detected</div>
        <span>${description}</span>
        <vscode-button id="close-button" icon="close" secondary aria-label="Close" title="Close">Close Panel</vscode-button>
        </div>
      </div>
    </div>
    `;
}

export async function markdownAsCollapsible(title: string, markdown?: string) {
  if (!markdown) return '';
  const html = await commands.executeCommand<string>('markdown.api.render', markdown.trim());
  return collapsibleContent(title, html);
}
