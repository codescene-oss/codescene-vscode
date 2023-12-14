import vscode, { window } from 'vscode';

interface RefactoringSuggestion {
  editor: vscode.TextEditor;
  document: vscode.TextDocument;
  range: vscode.Range;
  code: string;
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
    if (!this.currentRefactorSuggestion) return;

    const { editor, document, range, code } = this.currentRefactorSuggestion;
    editor.edit((editBuilder) => {
      editBuilder.replace(range, code);
    });
  }

  // todo this could take the refactoring I guess
  private update(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
    before: RefactorRequest,
    after: RefactorResponse
  ) {
    let { code, reasons, confidence } = after;
    code = code.trim(); // Service might have returned code with extra whitespace. Trim to make it match startLine when replacing
    const { start_line: startLine, end_line: endLine } = before.source_snippet;
    const range = new vscode.Range(startLine, 0, endLine, 0);
    const editor = window.activeTextEditor;
    if (!editor) {
      console.log('No active texteditor available!');
      return;
    }
    this.currentRefactorSuggestion = {
      editor,
      document,
      code,
      range,
    };

    this.setupWebView(extensionUri, confidence, reasons, code);
  }

  private setupWebView(extensionUri: vscode.Uri, confidence: RefactorConfidence, reasons: string[], code: string) {
    const { level, description } = confidence;
    const reasonText = reasons.join('. ');
    const styleUri = this.webViewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'assets', 'refactor-styles.css')
    );
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
   * @param before
   * @param after
   * @returns
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
    before: RefactorRequest,
    after: RefactorResponse
  ) {
    if (RefactoringPanel.currentPanel) {
      RefactoringPanel.currentPanel.webViewPanel.reveal(RefactoringPanel.column);
      return;
    }

    // Otherwise, create a new web view panel.
    RefactoringPanel.currentPanel = new RefactoringPanel();

    RefactoringPanel.currentPanel.update(extensionUri, document, before, after);
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
