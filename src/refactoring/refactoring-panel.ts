import vscode, { WorkspaceEdit, window, workspace } from 'vscode';
import { getLogoUrl } from '../utils';

interface RefactoringSuggestion {
  range: vscode.Range;
  code: string;
  documentToEdit: vscode.TextDocument;
}

export class RefactoringPanel {
  public static currentPanel: RefactoringPanel | undefined;
  private static readonly viewType = 'refactoringPanel';
  private static readonly column: vscode.ViewColumn = vscode.ViewColumn.Beside;

  private readonly extensionUri: vscode.Uri;
  private readonly webViewPanel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private currentRefactorSuggestion: RefactoringSuggestion | undefined;

  public constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    this.webViewPanel = window.createWebviewPanel(
      RefactoringPanel.viewType,
      'CodeScene AI Refactor',
      RefactoringPanel.column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out'), vscode.Uri.joinPath(extensionUri, 'assets')],
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
            this.dispose();
            return;
        }
      },
      null,
      this.disposables
    );
  }

  private applyRefactoring() {
    if (!this.currentRefactorSuggestion) {
      console.error('No refactoring suggestion to apply');
      return;
    }
    const { documentToEdit, range, code } = this.currentRefactorSuggestion;
    const workSpaceEdit = new WorkspaceEdit();
    workSpaceEdit.replace(documentToEdit.uri, range, code);
    workspace.applyEdit(workSpaceEdit);
    window.setStatusBarMessage(`$(sparkle) Successfully applied refactoring`, 3000);
  }

  private async updateWebView(
    document: vscode.TextDocument,
    request: RefactorRequest,
    response?: RefactorResponse | string
  ) {
    const styleUri = getUri(this.webViewPanel.webview, this.extensionUri, ['assets', 'refactor-styles.css']);
    const webviewScript = getUri(this.webViewPanel.webview, this.extensionUri, [
      'out',
      'refactoring-webview-script.js',
    ]);
    const csLogoUrl = await getLogoUrl(this.extensionUri.fsPath);

    let content = this.loadingContent();
    switch (typeof response) {
      case 'string':
        content = this.errorContent(response);
        break;
      case 'object':
        content = this.refactoringSuggestionContent(document, request, response);
        break;
    }
    // Note, the html "typehint" is used by the es6-string-html extension to enable highlighting of the html-string
    this.webViewPanel.webview.html = /*html*/ `
    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <link href="${styleUri}" rel="stylesheet" />
    </head>

    <body>
        <script type="module" nonce="${nonce}" src="${webviewScript}"></script>
        <h1><img src="data:image/png;base64,${csLogoUrl}" width="64" height="64" align="center"/>&nbsp; Refactoring recommendation</h1>
        <vscode-divider></vscode-divider>
        ${content}
    </body>

    </html>
    `;
  }

  private refactoringSuggestionContent(
    document: vscode.TextDocument,
    request: RefactorRequest,
    response: RefactorResponse
  ) {
    let { code, reasons, confidence } = response;
    code = code.trim(); // Service might have returned code with extra whitespace. Trim to make it match startLine when replacing
    const { start_line: startLine, end_line: endLine } = request.source_snippet;
    const range = new vscode.Range(startLine, 0, endLine, 0);
    this.currentRefactorSuggestion = { documentToEdit: document, code, range };

    const { level, description } = confidence;
    const reasonText = reasons.join('. ');

    const acceptDefault = level >= 2;

    return /*html*/ `
      <br/>
      <vscode-tag>${description}</vscode-tag>
      <div class="reasons">${reasonText}</div>
      <h2>Proposed change</h2>
      <div>
        <pre><code>${code}</code></pre>
      </div>
      <div class="buttons">
        <vscode-button id="reject-button" appearance="${acceptDefault ? 'secondary' : 'primary'}">Reject</vscode-button>
        <vscode-button id="apply-button" appearance="${acceptDefault ? 'primary' : 'secondary'}">Apply</vscode-button>
      </div>
  `;
  }

  private loadingContent() {
    return /*html*/ `<h2>Loading refactoring...</h2>
    <vscode-progress-ring></vscode-progress-ring>`;
  }

  private errorContent(errorMessage: string) {
    return /*html*/ `<h2>Refactoring failed</h2>
    <p>${errorMessage}</p>`;
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
  public static createOrShow(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
    request: RefactorRequest,
    response?: RefactorResponse | string
  ) {
    if (RefactoringPanel.currentPanel) {
      RefactoringPanel.currentPanel.updateWebView(document, request, response);
      RefactoringPanel.currentPanel.webViewPanel.reveal(RefactoringPanel.column);
      return;
    }

    // Otherwise, create a new web view panel.
    RefactoringPanel.currentPanel = new RefactoringPanel(extensionUri);
    RefactoringPanel.currentPanel.updateWebView(document, request, response);
  }
}

// Webview utility functions below
function getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
}

function nonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
