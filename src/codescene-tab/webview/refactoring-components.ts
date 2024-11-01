import { commands } from 'vscode';
import { CsExtensionState } from '../../cs-extension-state';
import { RefactorConfidence, RefactorResponse } from '../../refactoring/model';
import { CodeWithLangId, decorateCode } from '../../refactoring/utils';
import { collapsibleContent, markdownAsCollapsible } from './components';
import { readRawMarkdownDocs } from './utils';

export function refactoringSummary(confidence: RefactorConfidence) {
  const {
    level,
    'recommended-action': { details: actionDetails, description: action },
  } = confidence;
  const levelClass = `level-${level > 2 ? 'ok' : level}`;
  return /*html*/ `
    <div class="refactoring-summary ${levelClass}">
      <div class="refactoring-summary-header ${levelClass}">${action}</div>
      <span>${actionDetails}</span>
    </div>
    `;
}

export function refactoringContent(response: RefactorResponse, languageId: string) {
  const decoratedCode = decorateCode(response, languageId);
  const code = { content: decoratedCode, languageId };
  const { level } = response.confidence;
  if (level === 0) {
    return refactoringUnavailable();
  } else if (level === 1) {
    return codeImprovementContent(response, code);
  }
  return autoRefactorContent(response, code);
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
      ${collapsibleContent('Example code', await codeContainerContent(code, false))}
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

async function autoRefactorContent(response: RefactorResponse, code: CodeWithLangId) {
  const content = /*html*/ `
        ${acceptAndRejectButtons()}
        ${reasonsContent(response)}
        ${collapsibleContent('Refactored code', await codeContainerContent(code))}
    `;
  return content;
}

function reasonsContent(response: RefactorResponse) {
  const { 'reasons-with-details': reasonsWithDetails } = response;
  let reasonsList;
  if (reasonsWithDetails && reasonsWithDetails.length > 0) {
    const reasonText = reasonsWithDetails.map((reason) => `<li>${reason.summary}</li>`).join('\n');
    reasonsList = /*html*/ `
          <ul>${reasonText}</ul>
        `;
  }
  return collapsibleContent('Reasons for detailed review', reasonsList);
}

function acceptAndRejectButtons() {
  return /* html */ `
      <div class="button-container">
        <vscode-button id="apply-button" appearance="primary" aria-label="Accept Auto-Refactor" title="Accept Auto-Refactor">
          <span slot="start" class="codicon codicon-check"></span>
          Accept Auto-Refactor
        </vscode-button>
        <vscode-button id="reject-button" appearance="secondary" aria-label="Reject" title="Reject">
          <span slot="start" class="codicon codicon-circle-slash"></span>
          Reject
        </vscode-button>
      </div>
  `;
}

async function codeContainerContent(code: CodeWithLangId, showDiff = true) {
  // Use built in  markdown extension for rendering code
  const mdRenderedCode = await commands.executeCommand(
    'markdown.api.render',
    '```' + code.languageId + '\n' + code.content + '\n```'
  );

  const diffButton = showDiff
    ? /*html*/ `
          <vscode-button id="diff-button" appearance="secondary" aria-label="Show diff">
            <span slot="start" class="codicon codicon-diff"></span>
            Show diff
          </vscode-button>
        `
    : '';

  return /*html*/ `
      <div class="code-container">
        <div class="code-container-buttons">
          ${diffButton}
        <!-- slot="start" ? -->
          <vscode-button id="copy-to-clipboard-button" appearance="secondary" aria-label="Copy code" title="Copy code">
            <span slot="start" class="codicon codicon-clippy"></span>
            Copy
          </vscode-button>
        </div>      
        ${mdRenderedCode}
      </div>
    `;
}

export function refactoringUnavailable() {
  return /*html*/ `
    <div class="refactoring-unavailable-content">
      <p>Unfortunately, we are unable to provide a CodeScene ACE refactoring recommendation or a code improvement 
      guide at this time. We recommend reviewing your code manually to identify potential areas for enhancement. </p>
      <p>For further assistance, please refer to the <a href="https://codescene.io/docs">CodeScene documentation</a> 
      for best practices and guidance on improving your code.</p>
    </div>
    `;
}
