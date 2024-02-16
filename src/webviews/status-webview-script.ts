import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeDivider,
} from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider());

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('sign-in-button')?.addEventListener('click', () => sendMessage('sign-in'));
}