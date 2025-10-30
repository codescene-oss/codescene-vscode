import { Uri, Webview } from 'vscode';
import { CsExtensionState } from './cs-extension-state';

export function nonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function getUri(webView: Webview, ...pathSegments: string[]) {
  return webView.asWebviewUri(Uri.joinPath(CsExtensionState.extensionUri, ...pathSegments));
}

export function commonResourceRoots() {
  return [
    Uri.joinPath(CsExtensionState.extensionUri, 'out'),
    Uri.joinPath(CsExtensionState.extensionUri, 'assets'),
    Uri.joinPath(CsExtensionState.extensionUri, 'cs-cwf'),
  ];
}
