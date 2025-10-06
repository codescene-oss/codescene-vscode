import { commands } from 'vscode';
import { getEffectiveToken } from '../../devtools-api';
import { Confidence, FnToRefactor, RefactorResponse } from '../../devtools-api/refactor-models';
import { CodeWithLangId, decorateCode } from '../../refactoring/utils';
import { collapsibleContent, markdownAsCollapsible } from './components';
import { readRawMarkdownDocs } from './utils';

export function refactoringSummary(confidence: Confidence) {
  const {
    level,
    'recommended-action': { details: actionDetails, description: action },
  } = confidence;
  return customRefactoringSummary(level, action, actionDetails);
}

// The texts here should be from the service, but updating there would make it change for customers - so for now hardcode in these fns
export function summaryHeader(level: number, levelClass: string, action: string) {
  if (level >= 3) {
    return `<div class="refactoring-summary-header ${levelClass}">Refactoring improves Code Health</div>`;
  }
  return `<div class="refactoring-summary-header ${levelClass}">${action}</div>`;
}

export function summaryDetails(level: number, actionDetails: string) {
  switch (true) {
    case level === -2:
      return `<span>${actionDetails}</span>`;
    case level < 1:
      return '<span>The LLM failed to improve Code Health. The refactoring might still offer a structural step in the right direction - inspect and decide!</span>';
    default:
      return level < 3 ? `<span>${actionDetails}</span>` : '';
  }
}

export function customRefactoringSummary(level: number, action: string, actionDetails: string) {
  const levelClass = `level-${level > 0 ? level : 'error'}`;
  return /*html*/ `
  <div class="refactoring-summary ${levelClass}">
    ${summaryHeader(level, levelClass, action)}
    ${summaryDetails(level, actionDetails)}
  </div>
  `;
}

function retryButton() {
  return `<vscode-button id="retry-button" icon="sparkle" primary aria-label="Retry Auto-Refactor" title="Retry Auto-Refactor">
            Retry Auto-Refactor
          </vscode-button>`;
}

export function refactoringContent(response: RefactorResponse, languageId: string, isStale: boolean) {
  const decoratedCode = decorateCode(response, languageId);
  const code = { content: decoratedCode, languageId };
  return autoRefactorContent(response, code, isStale);
}

type Code = {
  content: string;
  languageId: string;
};

async function codeImprovementContent(response: RefactorResponse, code: Code) {
  const {
    'refactoring-properties': { 'removed-code-smells': removedCodeSmells },
  } = response;

  let solutionContent;
  if (removedCodeSmells.length > 0) {
    solutionContent = await codeSmellsGuide(removedCodeSmells[0]);
  } else {
    solutionContent = await codeSmellsGuide('modularity-improvement');
  }

  return /*html*/ `
      ${solutionContent}
      ${collapsibleContent('Example code', await codeContainerContent(code, false, 'copy-code-to-clipboard-button'))}
    `;
}
async function codeSmellsGuide(codeSmell: string) {
  const docsGuide = readRawMarkdownDocs(codeSmell, 'improvement-guides');
  const [problem, solution] = docsGuide.split('## Solution');

  return `
      ${await markdownAsCollapsible('Problem', problem)}
      ${await markdownAsCollapsible('Solution', solution)}
    `;
}

async function autoRefactorContent(response: RefactorResponse, code: CodeWithLangId, isStale: boolean) {
  const declarationsSection =
    response.declarations && response.declarations.trim()
      ? collapsibleContent(
          'Declarations for Refactored Code',
          await codeContainerContent(
            { content: response.declarations, languageId: code.languageId },
            false,
            'copy-declarations-to-clipboard-button'
          )
        )
      : '';

  const content = /*html*/ `
        ${isStale ? '' : acceptAndRejectButtons()}
        ${reasonsContent(response)}
        ${declarationsSection}
        ${collapsibleContent(
          'Refactored code',
          await codeContainerContent(code, true, 'copy-code-to-clipboard-button')
        )}
    `;
  return content;
}

function reasonsContent(response: RefactorResponse) {
  const {
    reasons,
    confidence: { 'review-header': reviewHeader, level },
  } = response;

  const reasonListItems = reasons.map((reason) => `<li>${reason.summary}</li>`);
  let reasonsText = reasonListItems.length > 0 ? `<ul>${reasonListItems.join('\n')}</ul>` : null;

  // ReviewHeader is optional in the API, but is always present for confidence > 1  (i.e. autoRefactorContent)
  const safeHeader = reviewHeader || 'Reasons for review';
  const isCollapsed = level > 2;
  return reasonsText ? collapsibleContent(safeHeader, reasonsText, isCollapsed) : '';
}

function acceptAndRejectButtons() {
  return /* html */ `
      <div class="button-container">
        <vscode-button id="apply-button" icon="check" primary aria-label="Accept Auto-Refactor" title="Accept Auto-Refactor">
          Accept Auto-Refactor
        </vscode-button>
        <vscode-button id="reject-button" icon="circle-slash" secondary aria-label="Reject" title="Reject">
          Reject
        </vscode-button>
      </div>
  `;
}

async function codeContainerContent(code: CodeWithLangId, showDiff = true, copyButtonId: string) {
  // Use built in  markdown extension for rendering code
  const mdRenderedCode = await commands.executeCommand(
    'markdown.api.render',
    '```' + code.languageId + '\n' + code.content + '\n```'
  );

  const diffButton = showDiff
    ? /*html*/ `
          <vscode-button id="diff-button" icon="diff" secondary aria-label="Show diff">
            Show diff
          </vscode-button>
        `
    : '';

  return /*html*/ `
      <div class="code-container">
        <div class="code-container-buttons">
          ${diffButton}
        <!-- slot="start" ? -->
          <vscode-button id="${copyButtonId}" icon="clippy" secondary aria-label="Copy code" title="Copy code">
            Copy
          </vscode-button>
        </div>
        <div class="code-content">
          ${mdRenderedCode}
        </div>
      </div>
    `;
}

async function unverifiedRefactoring(response: RefactorResponse, code: CodeWithLangId) {
  return /*html*/ `
    ${reasonsContent(response)}
    ${collapsibleContent(
      'Refactored code (unverified)',
      await codeContainerContent(code, false, 'copy-code-to-clipboard-button')
    )}
  `;
}

export function refactoringError(isAuthError = false) {
  switch (true) {
    case isAuthError:
      return '';
    default:
      return /*html*/ `
        <div class="refactoring-error-content">
          <p>Unfortunately, we are unable to provide a CodeScene ACE refactoring recommendation or a code improvement
          guide at this time. We recommend reviewing your code manually to identify potential areas for enhancement. </p>
          <p>For further assistance, please refer to the <a href="https://codescene.io/docs">CodeScene documentation</a>
          for best practices and guidance on improving your code.</p>
        </div>
        `;
  }
}

export function refactoringButton(refactoring?: FnToRefactor) {
  const hasValidToken = !!getEffectiveToken();

  if (!refactoring || !hasValidToken) {
    return /* html */ `
      <vscode-button id="refactoring-button" icon="circle-slash" secondary disabled>
        Auto-Refactor
      </vscode-button>`;
  }
  return /* html */ `
    <vscode-button id="refactoring-button" icon="sparkle" primary>
      Auto-Refactor
    </vscode-button>`;
}

export { reasonsContent };
