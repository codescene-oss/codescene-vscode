import { markdownAsCollapsible } from './components';
import { readRawMarkdownDocs } from './utils';

export function optionalRefactoringButton(hidden: boolean) {
  return /*html*/ `
    <div class="button-container">
      <vscode-button id="refactoring-button" icon="loading" icon-spin="true"
        ${hidden ? 'hidden' : ''}>
          Auto-refactor
      </vscode-button>
    </div>
  `;
}

/**
 * This relies on the docs being in the correct format, with the following sections (in order!):
 * - Description text
 * - \#\# Example (optional)
 * - \#\# Solution (optional)
 *
 * @param category Used for getting correct .md documentation from docs
 * @returns
 */
export async function docsForCategory(category: string) {
  const docsGuide = readRawMarkdownDocs(category, 'issues');

  let description = docsGuide,
    exampleAndSolution,
    example,
    solution;
  if (docsGuide.includes('## Solution')) {
    if (docsGuide.includes('## Example')) {
      [description, exampleAndSolution] = docsGuide.split('## Example');
      [example, solution] = exampleAndSolution.split('## Solution');
    } else {
      [description, solution] = docsGuide.split('## Solution');
    }
  }

  return /*html*/ `
      ${await markdownAsCollapsible(category, description)}
      ${await markdownAsCollapsible('Example', example)}
      ${await markdownAsCollapsible('Solution', solution)}
    `;
}
