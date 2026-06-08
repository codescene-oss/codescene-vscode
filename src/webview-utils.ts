import { randomBytes } from 'crypto';
import { Uri, Webview } from 'vscode';
import { CsExtensionState } from './cs-extension-state';

export function nonce() {
  return randomBytes(16).toString('base64');
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
