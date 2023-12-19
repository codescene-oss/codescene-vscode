import vscode, { WorkspaceEdit, window, workspace } from 'vscode';
import { getLogoUrl } from '../utils';

interface CurrentRefactorState {
  range: vscode.Range; // Range of code to be refactored
  code: string; // The code to replace the range with
  document: vscode.TextDocument; // The document to apply the refactoring to
  initiatorViewColumn?: vscode.ViewColumn; // ViewColumn of the initiating editor
}

interface RefactorPanelParams {
  document: vscode.TextDocument;
  initiatorViewColumn?: vscode.ViewColumn;
  fnToRefactor: vscode.DocumentSymbol;
  response?: RefactorResponse | string;
}
export class RefactoringPanel {
  public static currentPanel: RefactoringPanel | undefined;
  private static readonly viewType = 'refactoringPanel';

  private readonly extensionUri: vscode.Uri;
  private readonly webViewPanel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private currentRefactorState: CurrentRefactorState | undefined;

  public constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    this.webViewPanel = window.createWebviewPanel(
      RefactoringPanel.viewType,
      'CodeScene AI Refactor',
      vscode.ViewColumn.Beside,
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
            this.rejectRefactoring();
            this.dispose();
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
    const { document, range, code, initiatorViewColumn } = this.currentRefactorState;
    const workSpaceEdit = new WorkspaceEdit();
    workSpaceEdit.replace(document.uri, range, code);
    workspace.applyEdit(workSpaceEdit);

    const editor = await vscode.window.showTextDocument(document.uri, {
      preview: false,
      viewColumn: initiatorViewColumn,
    });

    const loc = code.split(/\r\n|\r|\n/).length;
    const newRange = new vscode.Range(range.start, range.start.translate(loc));
    editor.selection = new vscode.Selection(newRange.start, newRange.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

    window.setStatusBarMessage(`$(sparkle) Successfully applied refactoring`, 3000);
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
    editor.selection = new vscode.Selection(range.start, range.start);
  }

  private async updateWebView({ document, initiatorViewColumn, fnToRefactor, response }: RefactorPanelParams) {
    const styleUri = getUri(this.webViewPanel.webview, this.extensionUri, ['assets', 'refactor-styles.css']);
    const webviewScript = getUri(this.webViewPanel.webview, this.extensionUri, [
      'out',
      'refactoring-webview-script.js',
    ]);
    const csLogoUrl = await getLogoUrl(this.extensionUri.fsPath);

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

        content = this.refactoringSuggestionContent(description, reasons, code, level >= 2);
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
    description: string,
    reasons: string[],
    code: string,
    acceptDefault: boolean = false
  ) {
    const reasonText = reasons.join('. ');
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
  }: RefactorPanelParams & { extensionUri: vscode.Uri }) {
    if (RefactoringPanel.currentPanel) {
      RefactoringPanel.currentPanel.updateWebView({ document, initiatorViewColumn, fnToRefactor, response });
      RefactoringPanel.currentPanel.webViewPanel.reveal(
        initiatorViewColumn ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
      );
      return;
    }

    // Otherwise, create a new web view panel.
    RefactoringPanel.currentPanel = new RefactoringPanel(extensionUri);
    RefactoringPanel.currentPanel.updateWebView({ document, initiatorViewColumn, fnToRefactor, response });
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
