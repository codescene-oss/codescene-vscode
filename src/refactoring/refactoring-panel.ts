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
  private readonly webViewPanel: vscode.WebviewPanel;
  private static readonly column: vscode.ViewColumn = vscode.ViewColumn.Beside;
  private disposables: vscode.Disposable[] = [];

  private currentRefactorSuggestion: RefactoringSuggestion | undefined;

  public constructor() {
    this.webViewPanel = vscode.window.createWebviewPanel(
      RefactoringPanel.viewType,
      'CodeScene AI Refactor',
      RefactoringPanel.column,
      {
        enableScripts: true,
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
  }

  private update(extensionUri: vscode.Uri, document: vscode.TextDocument, request: RefactorRequest, response?: RefactorResponse) {
    if (!response) {
      this.setupLoadingView(extensionUri);
      return;
    }

    let { code, reasons, confidence } = response;
    code = code.trim(); // Service might have returned code with extra whitespace. Trim to make it match startLine when replacing
    const { start_line: startLine, end_line: endLine } = request.source_snippet;
    const range = new vscode.Range(startLine, 0, endLine, 0);
    this.currentRefactorSuggestion = { documentToEdit: document, code, range };

    this.setupWebView(extensionUri, confidence, reasons, code);
  }

  private async setupLoadingView(extensionUri: vscode.Uri) {
    const csLogoUrl = await getLogoUrl(extensionUri.fsPath);
    const styleUri = this.webViewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'assets', 'refactor-styles.css')
    );

    this.webViewPanel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <link href="${styleUri}" rel="stylesheet" />
    </head>
    <body>
        <img src="data:image/png;base64,${csLogoUrl}" width="64" height="64" align="center" />
        <h1>Refactoring recommendation</h1>
        <hr>
        <h2>Loading refactoring...</h2>
    </body>
    </html>
`;
  }

  private async setupWebView(
    extensionUri: vscode.Uri,
    confidence: RefactorConfidence,
    reasons: string[],
    code: string
  ) {
    const { level, description } = confidence;
    const reasonText = reasons.join('. ');
    const styleUri = this.webViewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'assets', 'refactor-styles.css')
    );
    const csLogoUrl = await getLogoUrl(extensionUri.fsPath);

    this.webViewPanel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    
    <head>
        <meta charset="UTF-8">
        <link href="${styleUri}" rel="stylesheet" />
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            function sendMessage(cmd) {
                const message = { command: cmd, text: 'Hello from webview!' };
                vscode.postMessage(message);
            }
        </script>
    </head>
    
    <body>
        <img src="data:image/png;base64,${csLogoUrl}" width="64" height="64" align="center" />
        <h1>Refactoring recommendation</h1>
        <hr>
        <h2>Confidence score</h2>
        <div class="confidence-label confidence-${level}">${description}</div>
        <div class="reasons">${reasonText}</div>
        <div>
          <pre><code>${code}</code></pre>
        </div>
        <div class="buttons">
          <button class="reject" onclick="sendMessage('reject')">Reject</button>
          <button class="apply" onclick="sendMessage('apply')">Apply</button>
        </div>
    </body>
    
    </html>
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
  public static createOrShow(extensionUri: vscode.Uri, document: vscode.TextDocument, request: RefactorRequest, response?: RefactorResponse) {
    if (RefactoringPanel.currentPanel) {
      RefactoringPanel.currentPanel.update(extensionUri, document, request, response);
      RefactoringPanel.currentPanel.webViewPanel.reveal(RefactoringPanel.column);
      return;
    }

    // Otherwise, create a new web view panel.
    RefactoringPanel.currentPanel = new RefactoringPanel();
    RefactoringPanel.currentPanel.update(extensionUri, document, request, response);
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
