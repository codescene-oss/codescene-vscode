import * as vscode from 'vscode';

export class RefactoringPanel {
  public static currentPanel: RefactoringPanel | undefined;
  public static viewType = 'refactoringPanel';
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public constructor() {
    this._panel = vscode.window.createWebviewPanel(
      RefactoringPanel.viewType,
      'CodeScene Refactor',
      vscode.ViewColumn.One,
      { enableScripts: true },
    );

    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'apply':
            vscode.window.showErrorMessage(message.text);
            return;
        }
      },
      null,
      this._disposables
    );

    this._update();
  }

  // todo this could take the refactoring I guess
private _update() {
    this._panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                function sendMessage() {
                    const message = { command: 'apply', text: 'Hello from webview!' };
                    vscode.postMessage(message);
                }
            </script>
        </head>
        <body>
            <button onclick="sendMessage()">Click me</button>
        </body>
        </html>
    `;
}

  public dispose() {
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  // TODO I don't get it
  public static createOrShow() {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // TODO how do we send data to the fing panel?
    if (RefactoringPanel.currentPanel) {
      RefactoringPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      RefactoringPanel.viewType,
      'CodeScene Refactor',
      column || vscode.ViewColumn.One,
      { enableScripts: true },
    );

    RefactoringPanel.currentPanel = new RefactoringPanel(panel);
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
