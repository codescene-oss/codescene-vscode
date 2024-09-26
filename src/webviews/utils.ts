import { Uri, Webview } from 'vscode';

export function nonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function getUri(webView: Webview, extensionUri: Uri, ...pathSegments: string[]) {
  return webView.asWebviewUri(Uri.joinPath(extensionUri, ...pathSegments));
}
