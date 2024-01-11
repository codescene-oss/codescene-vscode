import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeDivider,
  vsCodeProgressRing,
} from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider(), vsCodeProgressRing());

const vscode = acquireVsCodeApi();

window.addEventListener('load', main);

function main() {
  document.getElementById('reject-button')?.addEventListener('click', () => sendMessage('reject'));
  document.getElementById('apply-button')?.addEventListener('click', () => sendMessage('apply'));
  document.getElementById('copy-to-clipboard')?.addEventListener('click', () => sendMessage('copy-code'));
}

function sendMessage(command: string) {
  vscode.postMessage({ command });
}
