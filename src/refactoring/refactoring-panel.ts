import vscode, {
  Disposable,
  DocumentSymbol,
  Range,
  Selection,
  TextDocument,
  TextEditorRevealType,
  Uri,
  ViewColumn,
  WebviewPanel,
  WorkspaceEdit,
} from 'vscode';
import { getLogoUrl } from '../utils';

interface CurrentRefactorState {
  range: Range; // Range of code to be refactored
  code: string; // The code to replace the range with
  document: TextDocument; // The document to apply the refactoring to
  initiatorViewColumn?: ViewColumn; // ViewColumn of the initiating editor
}

interface RefactorPanelParams {
  document: TextDocument;
  initiatorViewColumn?: ViewColumn;
  fnToRefactor: DocumentSymbol;
  response?: RefactorResponse | string;
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
      'CodeScene AI Refactor',
      ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(extensionUri, 'out'), Uri.joinPath(extensionUri, 'assets')],
      }
    );

    this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webViewPanel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'apply':
            this.applyRefactoring();
            this.dispose();
            return;
          case 'reject':
            this.rejectRefactoring();
            this.dispose();
            return;
          case 'copy-code':
            vscode.window.setStatusBarMessage(`$(clippy) Copied refactoring suggestion to clipboard`, 3000);
            vscode.env.clipboard.writeText(this.currentRefactorState?.code || '');
            return;
        }
      },
      null,
      this.disposables
    );
  }

  private async applyRefactoring() {
    if (!this.currentRefactorState) {
      console.error('No refactoring suggestion to apply');
      return;
    }
    const { document, range, code } = this.currentRefactorState;
    const workSpaceEdit = new WorkspaceEdit();
    workSpaceEdit.replace(document.uri, range, code);
    vscode.workspace.applyEdit(workSpaceEdit);
    await this.selectCurrentRefactoring();
    vscode.window.setStatusBarMessage(`$(sparkle) Successfully applied refactoring`, 3000);
  }

  private async selectCurrentRefactoring() {
    if (!this.currentRefactorState) return;
    const { document, range, code, initiatorViewColumn } = this.currentRefactorState;
    const editor = await vscode.window.showTextDocument(document.uri, {
      preview: false,
      viewColumn: initiatorViewColumn,
    });
    const lines = code.split(/\r\n|\r|\n/);
    const lineDelta = lines.length - 1;
    const characterDelta = lines[lines.length - 1].length - 1;
    const newRange = new Range(range.start, range.start.translate({ lineDelta, characterDelta }));
    editor.selection = new Selection(newRange.start, newRange.end);
    editor.revealRange(range, TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async rejectRefactoring() {
    if (!this.currentRefactorState) {
      console.error('No refactoring suggestion to apply');
      return;
    }
    // Get original document and deselect the function to refactor.
    const { document, range, initiatorViewColumn } = this.currentRefactorState;
    const editor = await vscode.window.showTextDocument(document.uri, {
      preview: false,
      viewColumn: initiatorViewColumn,
    });
    editor.selection = new Selection(range.start, range.start);
  }

  private async updateWebView({ document, initiatorViewColumn, fnToRefactor, response }: RefactorPanelParams) {
    const refactorStylesCss = this.getUri('assets', 'refactor-styles.css');
    const markdownLangCss = this.getUri('assets', 'markdown-languages.css');
    const highlightCss = this.getUri('assets', 'highlight.css');
    const webviewScript = this.getUri('out', 'refactoring-webview-script.js');
    const csLogoUrl = await getLogoUrl(this.extensionUri.fsPath);
    const codiconsUri = this.getUri('out', 'codicons', 'codicon.css');

    const range = fnToRefactor.range;
    let content = this.loadingContent();
    switch (typeof response) {
      case 'string':
        this.currentRefactorState = { document, code: 'n/a', range, initiatorViewColumn };
        content = this.errorContent(response);
        break;
      case 'object':
        let { code, reasons, confidence } = response;
        const { level, description } = confidence;
        code = code.trim(); // Service might have returned code with extra whitespace. Trim to make it match startLine when replacing
        this.currentRefactorState = { document, code, range, initiatorViewColumn };

        content = await this.refactoringSuggestionContent(confidence, reasons, code, document.languageId);
        break;
    }

    // Note, the html "typehint" is used by the es6-string-html extension to enable highlighting of the html-string
    this.webViewPanel.webview.html = /*html*/ `
    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <link href="${markdownLangCss}" type="text/css" rel="stylesheet" />
        <link href="${highlightCss}" type="text/css" rel="stylesheet" />
        <link href="${codiconsUri}" type="text/css" rel="stylesheet" />
        <link href="${refactorStylesCss}" type="text/css" rel="stylesheet" />
    </head>

    <body>
        <script type="module" nonce="${nonce}" src="${webviewScript}"></script>
        <h1><img src="data:image/png;base64,${csLogoUrl}" width="64" height="64" align="center"/>&nbsp; Refactoring recommendation</h1>
        ${content}
    </body>

    </html>
    `;
  }

  private getUri(...pathSegments: string[]) {
    return this.webViewPanel.webview.asWebviewUri(Uri.joinPath(this.extensionUri, ...pathSegments));
  }

  private async refactoringSuggestionContent(
    confidence: RefactorConfidence,
    reasons: string[],
    code: string,
    languageId: string
  ) {
    const {
      level,
      recommendedAction: { details: actionDetails, description: action },
    } = confidence;
    const acceptDefault = level >= 2;
    // Use built in  markdown extension for rendering code
    const mdRenderedCode = await vscode.commands.executeCommand(
      'markdown.api.render',
      '```' + languageId + '\n' + code + '\n```'
    );

    const actionBadgeClass = `action-badge level-${level}`;

    let reasonsContent = '';
    if (reasons && reasons.length > 0) {
      const reasonText = reasons.map((reason) => `<li>${reason}</li>`).join('\n');
      reasonsContent = /*html*/ `
        <h4>Reasons for manual review</h4>
        <ul>${reasonText}</ul>
      `;
    }
    return /*html*/ `
      <p> 
        <span class="${actionBadgeClass}"}>${action}</span> ${actionDetails}
      </p>  
      ${reasonsContent}
      <h4>Proposed refactoring</h4>
      <div class="code-container">
        <vscode-button id="copy-to-clipboard" appearance="icon" aria-label="Copy code" title="Copy code">
          <span class="codicon codicon-clippy"></span>
        </vscode-button>
        ${mdRenderedCode}
      </div>
      <div class="buttons">
        <vscode-button id="reject-button" appearance="${acceptDefault ? 'secondary' : 'primary'}">Reject</vscode-button>
        <vscode-button id="apply-button" appearance="${acceptDefault ? 'primary' : 'secondary'}">Apply</vscode-button>
      </div>
  `;
  }

  private loadingContent() {
    return /*html*/ `<h2>Refactoring...</h2>
    <vscode-progress-ring></vscode-progress-ring>`;
  }

  private errorContent(errorMessage: string) {
    return /*html*/ `<h2>Refactoring failed</h2>
    <p>${errorMessage}</p>
    <div class="buttons">
      <vscode-button id="reject-button" appearance="primary">Close</vscode-button>
    </div>
`;
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
   * @param document Ref to document to apply refactoring to
   * @param request
   * @param response
   * @returns
   */
  public static createOrShow({
    extensionUri,
    document,
    initiatorViewColumn,
    fnToRefactor,
    response,
  }: RefactorPanelParams & { extensionUri: Uri }) {
    if (RefactoringPanel.currentPanel) {
      RefactoringPanel.currentPanel.updateWebView({ document, initiatorViewColumn, fnToRefactor, response });
      RefactoringPanel.currentPanel.webViewPanel.reveal(initiatorViewColumn ? ViewColumn.Beside : ViewColumn.Active);
      return;
    }

    // Otherwise, create a new web view panel.
    RefactoringPanel.currentPanel = new RefactoringPanel(extensionUri);
    RefactoringPanel.currentPanel.updateWebView({ document, initiatorViewColumn, fnToRefactor, response });
  }
}

function nonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
