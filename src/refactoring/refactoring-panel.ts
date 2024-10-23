import { readFile } from 'fs/promises';
import path, { join } from 'path';
import vscode, { Disposable, Selection, Uri, ViewColumn, WebviewPanel } from 'vscode';
import { categoryToDocsCode } from '../documentation/csdoc-provider';
import { logOutputChannel } from '../log';
import Telemetry from '../telemetry';
import { getLogoUrl } from '../utils';
import { getUri, nonce } from '../webviews/utils';
import { FnToRefactor, refactoringSymbol, toConfidenceSymbol } from './commands';
import { CsRefactoringRequest } from './cs-refactoring-requests';
import { RefactorResponse } from './model';
import { CodeWithLangId, decorateCode, targetEditor } from './utils';
import {
  collapsibleContent,
  readRawMarkdownDocs,
  renderedSegment,
  renderHtmlTemplate,
} from '../webviews/doc-and-refac-common';

interface RefactorPanelParams {
  refactoring: CsRefactoringRequest;
  viewColumn?: ViewColumn;
}

type Code = {
  content: string;
  languageId: string;
};

export class RefactoringPanel {
  public static currentPanel: RefactoringPanel | undefined;
  private static readonly viewType = 'refactoringPanel';

  private readonly webViewPanel: WebviewPanel;
  private disposables: Disposable[] = [];

  private currentRefactoring?: CsRefactoringRequest;

  public constructor(private extensionUri: Uri, viewColumn?: ViewColumn) {
    this.webViewPanel = vscode.window.createWebviewPanel(
      RefactoringPanel.viewType,
      'CodeScene ACE',
      { viewColumn: viewColumn || ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(extensionUri, 'out'), Uri.joinPath(extensionUri, 'assets')],
      }
    );

    this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webViewPanel.webview.onDidReceiveMessage(
      async (message) => {
        if (!this.currentRefactoring) {
          return;
        }
        const refactoring = this.currentRefactoring;
        switch (message.command) {
          case 'apply':
            vscode.commands.executeCommand('codescene.applyRefactoring', refactoring).then(
              () => {
                this.dispose();
              },
              (error) => {
                logOutputChannel.error(error);
              }
            );
            return;
          case 'reject':
            await this.deselectRefactoring(refactoring);
            this.dispose();
            return;
          case 'copy-code':
            const decoratedCode = decorateCode(await refactoring.promise, refactoring.document.languageId);
            await vscode.env.clipboard.writeText(decoratedCode);
            void vscode.window.showInformationMessage('Copied refactoring suggestion to clipboard');
            return;
          case 'show-diff':
            void vscode.commands.executeCommand('codescene.showDiffForRefactoring', refactoring);
            return;
        }
      },
      this,
      this.disposables
    );
  }

  private async deselectRefactoring(refactoring: CsRefactoringRequest) {
    const editor = targetEditor(refactoring.document);
    if (editor) {
      editor.selection = new Selection(0, 0, 0, 0);
    }
  }

  private async updateWebView({ refactoring }: RefactorPanelParams) {
    const { fnToRefactor, promise, document } = refactoring;

    this.currentRefactoring = refactoring;

    await this.updateContent('Refactoring...', this.loadingContent());

    const fnLocContent = this.functionLocationContent(this.currentRefactoring.fnToRefactor);

    promise
      .then(async (response) => {
        if (!this.currentRefactoring) {
          return;
        }
        const {
          confidence: { level, title },
        } = response;

        const highlightCode = toConfidenceSymbol(level) === refactoringSymbol;
        const editor = targetEditor(document);
        if (highlightCode && editor) {
          editor.selection = new vscode.Selection(fnToRefactor.range.start, fnToRefactor.range.end);
        }

        await this.updateContent(title, [
          fnLocContent,
          this.refactoringSummary(response), // TODO - change title and texts in the service
          await this.autoRefactorOrCodeImprovementContent(response, document.languageId),
        ]);
      })
      .catch(async (error) => {
        await this.updateContent('Auto-refactor error', [fnLocContent, this.errorContent(error)]);
      });
  }

  private async updateContent(title: string, content: string | string[]) {
    renderHtmlTemplate(this.webViewPanel, this.extensionUri, {
      title,
      bodyContent: content,
      cssPaths: [['out', 'refactoring', 'styles.css']],
      scriptPaths: [['out', 'refactoring', 'webview-script.js']],
    });
  }

  private loadingContent() {
    return /*html*/ `<div class="loading-content">
      <vscode-progress-ring class="progress-ring"></vscode-progress-ring><span id="loading-span"></span>
    </div>`;
  }

  private errorContent(error: any) {
    let errorMessage = error.message || 'Unknown error';

    return /*html*/ `<h2>Refactoring failed</h2>
    <p>There was an error when performing this refactoring. Here's the response from the refactoring service:</p>
    <pre>${errorMessage}</pre>
    <div class="bottom-controls">
      <div></div> <!-- Spacer, making sure close button is right aligned -->
      <div class="button-group right">
        <vscode-button id="close-button" appearance="primary">Close</vscode-button>
      </div>
    </div>
`;
  }

  private refactoringUnavailable() {
    return /*html*/ `
    <div>
      <p>Unfortunately, we are unable to provide a CodeScene ACE refactoring recommendation or a code improvement 
      guide at this time. We recommend reviewing your code manually to identify potential areas for enhancement. </p>
      <p>For further assistance, please refer to the <a href="https://codescene.io/docs">CodeScene documentation</a> 
      for best practices and guidance on improving your code.</p>
    </div>
`;
  }

  private autoRefactorOrCodeImprovementContent(response: RefactorResponse, languageId: string) {
    const decoratedCode = decorateCode(response, languageId);
    const code = { content: decoratedCode, languageId };
    const { level } = response.confidence;
    if (level === 0) {
      return this.refactoringUnavailable();
    } else if (level === 1) {
      return this.codeImprovementContent(response, code);
    }
    return this.autoRefactorContent(response, code);
  }

  private functionLocationContent(fnToRefactor: FnToRefactor) {
    const { range, filePath, name } = fnToRefactor;
    const fileName = path.basename(filePath);

    return /*html*/ `
      <div id="function-location" class="flex-row">
        <span class="file-name">${fileName}</span>
        <span class="codicon codicon-symbol-method"></span>
        ${name}
        <span class="line-no">[Ln ${range.start.line + 1}]</span>
      </div>
      <hr>
      `;
  }

  private refactoringSummary(response: RefactorResponse) {
    const { confidence } = response;
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

  private reasonsContent(response: RefactorResponse) {
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

  private async autoRefactorContent(response: RefactorResponse, code: CodeWithLangId) {
    const content = /*html*/ `
        ${this.acceptAndRejectButtons()}
        ${this.reasonsContent(response)}
        ${collapsibleContent('Refactored code', await this.codeContainerContent(code))}
    `;
    return content;
  }

  private acceptAndRejectButtons() {
    return /* html */ `
      <div class="accept-reject-buttons">
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

  private async codeContainerContent(code: CodeWithLangId, showDiff = true) {
    // Use built in  markdown extension for rendering code
    const mdRenderedCode = await vscode.commands.executeCommand(
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

  private async codeSmellsGuide(codeSmell: string) {
    const docsGuide = readRawMarkdownDocs(codeSmell, 'improvement-guides', this.extensionUri);
    const [problem, solution] = docsGuide.split('## Solution');

    return `
      ${await renderedSegment('Problem', problem)}
      ${await renderedSegment('Solution', solution)}
    `;
  }

  private async codeImprovementContent(response: RefactorResponse, code: Code) {
    const {
      'refactoring-properties': { 'removed-code-smells': removedCodeSmells },
    } = response;

    let solutionContent;
    if (removedCodeSmells.length > 0) {
      solutionContent = await this.codeSmellsGuide(removedCodeSmells[0]);
    } else {
      solutionContent = await this.codeSmellsGuide('modularity-improvement');
    }

    return /*html*/ `
      ${solutionContent}
      ${collapsibleContent('Example code', await this.codeContainerContent(code, false))}
    `;
  }

  public dispose() {
    RefactoringPanel.currentPanel = undefined;
    this.webViewPanel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  /**
   *
   * @param extensionUri Used to resolve resource paths for the webview content
   * @param resolvedRequest Current refac request to present
   * @returns
   */
  public static createOrShow({ extensionUri, refactoring, viewColumn }: RefactorPanelParams & { extensionUri: Uri }) {
    Telemetry.instance.logUsage('refactor/presented', { 'trace-id': refactoring.traceId });

    if (RefactoringPanel.currentPanel) {
      void RefactoringPanel.currentPanel.updateWebView({ refactoring });
      RefactoringPanel.currentPanel.webViewPanel.reveal(viewColumn, true);
      return;
    }

    // Otherwise, create a new web view panel.
    RefactoringPanel.currentPanel = new RefactoringPanel(extensionUri, viewColumn);
    void RefactoringPanel.currentPanel.updateWebView({ refactoring });
  }
}
