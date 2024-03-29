// @CodeScene(disable:"Primitive Obsession", disable:"Bumpy Road Ahead")
import { readFile } from 'fs/promises';
import { join } from 'path';
import vscode, {
  Disposable,
  Range,
  Selection,
  TextEditorRevealType,
  Uri,
  ViewColumn,
  WebviewPanel,
  WorkspaceEdit,
} from 'vscode';
import { categoryToDocsCode } from '../csdoc';
import { logOutputChannel } from '../log';
import Telemetry from '../telemetry';
import { getLogoUrl } from '../utils';
import { nonce } from '../webviews/utils';
import { FnToRefactor, refactoringSymbol, toConfidenceSymbol } from './commands';
import { CsRefactoringRequests, ResolvedRefactoring } from './cs-refactoring-requests';
import { RefactorResponse } from './model';
import { decorateCode, targetEditor } from './utils';

interface CurrentRefactorState {
  refactoring: ResolvedRefactoring;
  range: Range; // Range of code to be refactored
  code: string; // The code to replace the range with
}

interface RefactorPanelParams {
  refactoring: ResolvedRefactoring;
}

export class RefactoringPanel {
  public static currentPanel: RefactoringPanel | undefined;
  private static readonly viewType = 'refactoringPanel';

  private readonly webViewPanel: WebviewPanel;
  private disposables: Disposable[] = [];

  private currentRefactorState: CurrentRefactorState | undefined;

  public constructor(private extensionUri: Uri) {
    this.webViewPanel = vscode.window.createWebviewPanel(
      RefactoringPanel.viewType,
      'CodeScene ACE',
      { viewColumn: ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(extensionUri, 'out'), Uri.joinPath(extensionUri, 'assets')],
      }
    );

    this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webViewPanel.webview.onDidReceiveMessage(
      async (message) => {
        if (!this.currentRefactorState) {
          return;
        }
        const refactoringState = this.currentRefactorState;
        switch (message.command) {
          case 'apply':
            await this.applyRefactoring(refactoringState);
            Telemetry.instance.logUsage('refactor/applied', { 'trace-id': refactoringState.refactoring.traceId });
            vscode.window.setStatusBarMessage(`$(sparkle) Successfully applied refactoring`, 3000);
            this.dispose();
            return;
          case 'close':
            await this.deselectRefactoring(refactoringState);
            this.dispose();
            return;
          case 'copy-code':
            vscode.window.setStatusBarMessage(`$(clippy) Copied refactoring suggestion to clipboard`, 3000);
            await vscode.env.clipboard.writeText(refactoringState.code);
            return;
          case 'show-diff':
            await this.showDiff(refactoringState);
            Telemetry.instance.logUsage('refactor/diff-shown', { 'trace-id': refactoringState.refactoring.traceId });
            return;
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * Create a virtual document used for tmp diffing in the editor.
   * The scheme is registered with a content provider in extension.ts
   * @param name
   * @param content
   * @param languageId
   * @returns
   */
  private async createTempDocument(name: string, content: string, languageId: string) {
    const tmpUri = vscode.Uri.from({ scheme: 'tmp-diff', path: name, query: content });
    const tmpDoc = await vscode.workspace.openTextDocument(tmpUri);
    return vscode.languages.setTextDocumentLanguage(tmpDoc, languageId);
  }

  private async showDiff(refactoringState: CurrentRefactorState) {
    const {
      refactoring: { document },
      range,
      code,
    } = refactoringState;

    // Create temporary virtual documents to use in the diff command. Just opening a new document with the new code
    // imposes a save dialog on the user when closing the diff.
    const originalCodeTmpDoc = await this.createTempDocument('Original', document.getText(range), document.languageId);
    const refactoringTmpDoc = await this.createTempDocument('Refactoring', code, document.languageId);

    // Use showTextDocument using the tmp doc and the target editor view column to set that editor active.
    // The diff command will then open in that same viewColumn, and not on top of the ACE panel.
    const editor = targetEditor(document);
    await vscode.window.showTextDocument(originalCodeTmpDoc, editor?.viewColumn, false);
    await vscode.commands.executeCommand('vscode.diff', originalCodeTmpDoc.uri, refactoringTmpDoc.uri);
  }

  private async applyRefactoring(refactoringState: CurrentRefactorState) {
    const {
      refactoring: { document },
      range,
      code,
    } = refactoringState;
    const workSpaceEdit = new WorkspaceEdit();
    workSpaceEdit.replace(document.uri, range, code);
    await vscode.workspace.applyEdit(workSpaceEdit);
    CsRefactoringRequests.deleteByFnRange(document, range);
    await this.selectCurrentRefactoring(refactoringState);
  }

  /**
   * Returns a new range locating the code relative the original range.
   * @param range
   * @param code
   */
  private relativeRangeFromCode(range: Range, code: string) {
    const lines = code.split(/\r\n|\r|\n/);
    const lineDelta = lines.length - 1;
    const characterDelta = lines[lines.length - 1].length;
    return new Range(range.start, range.start.translate({ lineDelta, characterDelta }));
  }

  /**
   * Selects the current refactoring in the target editor. If no target editor is found
   * (manually closed), a new editor is opened for showing the applied refactoring.
   */
  private async selectCurrentRefactoring(refactoringState: CurrentRefactorState) {
    const { range, code, refactoring } = refactoringState;
    const newRange = this.relativeRangeFromCode(range, code);

    const editor =
      targetEditor(refactoring.document) ||
      (await vscode.window.showTextDocument(refactoring.document.uri, {
        preview: false,
        viewColumn: ViewColumn.One,
      }));
    editor.selection = new Selection(newRange.start, newRange.end);
    editor.revealRange(newRange, TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async deselectRefactoring(refactoringState: CurrentRefactorState) {
    // Get original document and deselect the function to refactor.
    const { range, refactoring } = refactoringState;
    const editor = targetEditor(refactoring.document);
    if (editor) {
      editor.selection = new Selection(range.start, range.start);
    }
  }

  private async updateWebView({ refactoring }: RefactorPanelParams) {
    const { fnToRefactor, response, document } = refactoring;
    const highlightCode = toConfidenceSymbol(response.confidence.level) === refactoringSymbol;
    const editor = targetEditor(document);
    if (highlightCode && editor) {
      editor.selection = new vscode.Selection(fnToRefactor.range.start, fnToRefactor.range.end);
    }
    const range = fnToRefactor.range;
    this.currentRefactorState = {
      refactoring,
      code: 'n/a',
      range,
    };

    const { code } = response;
    const title = response.confidence.title;
    const decoratedCode = decorateCode(code, document.languageId, response['reasons-with-details']);
    this.currentRefactorState.code = decoratedCode;

    const content = await this.autoRefactorOrCodeImprovementContent(response, decoratedCode, document.languageId);

    const refactorStylesCss = this.getUri('assets', 'refactor-styles.css');
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
        ${this.functionInfoContent(fnToRefactor)}
        ${content}
    </body>

    </html>
    `;
  }

  private getUri(...pathSegments: string[]) {
    return this.webViewPanel.webview.asWebviewUri(Uri.joinPath(this.extensionUri, ...pathSegments));
  }

  private async autoRefactorOrCodeImprovementContent(response: RefactorResponse, code: string, languageId: string) {
    const { level } = response.confidence;
    if (level >= 2) {
      return this.autoRefactorContent(response, code, languageId);
    }
    return this.codeImprovementContent(response, code, languageId);
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

  private async codeContainerContent(code: string, languageId: string) {
    // Use built in  markdown extension for rendering code
    const mdRenderedCode = await vscode.commands.executeCommand(
      'markdown.api.render',
      '```' + languageId + '\n' + code + '\n```'
    );
    return /*html*/ `
    <div class="code-container">
      <vscode-button id="copy-to-clipboard" appearance="icon" aria-label="Copy code" title="Copy code">
        <span class="codicon codicon-clippy"></span>
      </vscode-button>
      ${mdRenderedCode}
    </div>`;
  }

  private async autoRefactorContent(response: RefactorResponse, code: string, languageId: string) {
    const { confidence, 'reasons-with-details': reasonsWithDetails } = response;
    const {
      level,
      'recommended-action': { details: actionDetails, description: action },
    } = confidence;
    const actionBadgeClass = `action-badge level-${level}`;

    const reasonsList = this.getReasonsList(response);
    const reasonsText = reasonsList ? `<h4>Reasons for detailed review</h4>\n${reasonsList}` : '';

    const content = /*html*/ `
        <p> 
          <span class="${actionBadgeClass}">${action}</span> ${actionDetails}
        </p>  
        ${reasonsText}
        ${await this.codeContainerContent(code, languageId)}
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
    const path = join(this.extensionUri.fsPath, 'docs', docsPath);
    const docsGuide = await readFile(path);
    return vscode.commands.executeCommand<string>('markdown.api.render', docsGuide.toString());
  }

  private async codeImprovementContent(response: RefactorResponse, code: string, languageId: string) {
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
        ${await this.codeContainerContent(code, languageId)}
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
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  /**
   *
   * @param extensionUri Used to resolve resource paths for the webview content
   * @param resolvedRequest Current refac request to present
   * @returns
   */
  public static createOrShow({ extensionUri, refactoring }: RefactorPanelParams & { extensionUri: Uri }) {
    Telemetry.instance.logUsage('refactor/presented', { 'trace-id': refactoring.traceId });

    if (RefactoringPanel.currentPanel) {
      void RefactoringPanel.currentPanel.updateWebView({ refactoring });
      RefactoringPanel.currentPanel.webViewPanel.reveal(undefined, true);
      return;
    }

    // Otherwise, create a new web view panel.
    RefactoringPanel.currentPanel = new RefactoringPanel(extensionUri);
    void RefactoringPanel.currentPanel.updateWebView({ refactoring });
  }
}
