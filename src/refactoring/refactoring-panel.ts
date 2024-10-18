import { readFile } from 'fs/promises';
import { join } from 'path';
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
          case 'close':
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
        const content = await this.autoRefactorOrCodeImprovementContent(response, document.languageId);
        await this.updateContent(level === 0 ? 'Refactoring failure' : title, content);
      })
      .catch(async (error) => {
        await this.updateContent('Auto-refactor error', this.errorContent(error));
      });
  }

  private async updateContent(title: string, content: string) {
    const refactorStylesCss = this.getUri('out', 'refactoring', 'styles.css');
    const markdownLangCss = this.getUri('assets', 'markdown-languages.css');
    const highlightCss = this.getUri('assets', 'highlight.css');
    const webviewScript = this.getUri('out', 'refactoring', 'webview-script.js');
    const csLogoUrl = await getLogoUrl(this.extensionUri.fsPath);
    const codiconsUri = this.getUri('out', 'codicons', 'codicon.css');
    const webView = this.webViewPanel.webview;
    // Note, the html "typehint" is used by the es6-string-html extension to enable highlighting of the html-string
    webView.html = /*html*/ `
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
        <link href="${markdownLangCss}" type="text/css" rel="stylesheet" />
        <link href="${highlightCss}" type="text/css" rel="stylesheet" />
        <link href="${codiconsUri}" type="text/css" rel="stylesheet" />
        <link href="${refactorStylesCss}" type="text/css" rel="stylesheet" />
    </head>

    <body>
        <script type="module" nonce="${nonce()}" src="${webviewScript}"></script>
        <h1><img src="data:image/png;base64,${csLogoUrl}" width="64" height="64" align="center"/>&nbsp; ${title}</h1>
        ${content}
    </body>

    </html>
    `;
  }

  private getUri(...pathSegments: string[]) {
    return getUri(this.webViewPanel.webview, this.extensionUri, ...pathSegments);
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

  private unsuitableRefactoring() {
    return /*html*/ `<h2>Refactoring failed</h2>
    <p>Sorry, we were unable to find a suitable refactoring. Please check the documentation for the code smell at the top of the method.</p>
    <div class="bottom-controls">
      <div></div> <!-- Spacer, making sure close button is right aligned -->
      <div class="button-group right">
        <vscode-button id="close-button" appearance="primary">Close</vscode-button>
      </div>
    </div>
`;
  }

  private autoRefactorOrCodeImprovementContent(response: RefactorResponse, languageId: string) {
    const decoratedCode = decorateCode(response, languageId);
    const code = { content: decoratedCode, languageId };
    const { level } = response.confidence;
    if (level >= 2) {
      return this.autoRefactorContent(response, code);
    } else if (level === 0) {
      return this.unsuitableRefactoring();
    }
    return this.codeImprovementContent(response, code);
  }

  private functionInfoContent(fnToRefactor: FnToRefactor) {
    const { range } = fnToRefactor;
    return /*html*/ `
    <div class="function-info">
      <strong>Target function:</strong> <code>${fnToRefactor.name} [Ln ${range.start.line + 1}, Col ${
      range.start.character
    }]</code>
    </div>`;
  }

  private async codeContainerContent(code: CodeWithLangId) {
    // Use built in  markdown extension for rendering code
    const mdRenderedCode = await vscode.commands.executeCommand(
      'markdown.api.render',
      '```' + code.languageId + '\n' + code.content + '\n```'
    );
    return /*html*/ `
    <div class="code-container">
      <vscode-button id="copy-to-clipboard" appearance="icon" aria-label="Copy code" title="Copy code">
        <span class="codicon codicon-clippy"></span>
      </vscode-button>
      ${mdRenderedCode}
    </div>`;
  }

  private async autoRefactorContent(response: RefactorResponse, code: CodeWithLangId) {
    const { confidence } = response;
    const {
      level,
      'recommended-action': { details: actionDetails, description: action },
    } = confidence;
    const actionBadgeClass = `action-badge level-${level > 2 ? 'green' : level}`;

    const reasonsList = this.getReasonsList(response);
    const reasonsText = reasonsList ? `<h4>Reasons for detailed review</h4>\n${reasonsList}` : '';

    const content = /*html*/ `
        <p> 
          <span class="${actionBadgeClass}">${action}</span> ${actionDetails}
        </p>  
        ${reasonsText}
        ${await this.codeContainerContent(code)}
        <div class="bottom-controls">
          <div class="button-group left">
            <vscode-button id="diff-button" aria-label="Show diff">Show diff</vscode-button>
          </div>
          <div class="button-group right">
            <vscode-button id="close-button" appearance="secondary" aria-label="Close" title="Close">Close</vscode-button>
            <vscode-button id="apply-button" appearance="primary" aria-label="Apply and close" title="Apply and close">Apply</vscode-button>
          </div>
        </div>
  `;
    return content;
  }

  private async codeSmellsGuide(codeSmell: string) {
    const docsPath = categoryToDocsCode(codeSmell) + '-guide.md';
    const path = join(this.extensionUri.fsPath, 'docs', 'improvement-guides', docsPath);
    const docsGuide = await readFile(path);
    return vscode.commands.executeCommand<string>('markdown.api.render', docsGuide.toString());
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

    const content = /*html*/ `
        ${solutionContent}
        <h4>Example from your code</h4>
        ${await this.codeContainerContent(code)}
        <div class="bottom-controls">
          <div class="button-group left">
            <vscode-button id="diff-button" aria-label="Show diff">Show diff</vscode-button>
          </div>
          <div class="button-group right">
            <vscode-button id="close-button" appearance="primary" aria-label="Close" title="Close">Close</vscode-button>
          </div>
        </div>
  `;
    return content;
  }

  private getReasonsList(response: RefactorResponse) {
    const { 'reasons-with-details': reasonsWithDetails } = response;
    if (reasonsWithDetails && reasonsWithDetails.length > 0) {
      const reasonText = reasonsWithDetails.map((reason) => `<li>${reason.summary}</li>`).join('\n');
      return /*html*/ `
          <ul>${reasonText}</ul>
        `;
    }
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
