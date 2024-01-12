import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeDivider,
  vsCodeProgressRing,
  vsCodeCheckbox,
} from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider(), vsCodeProgressRing(), vsCodeCheckbox());

const vscode = acquireVsCodeApi();

window.addEventListener('load', main);

function main() {
  document.getElementById('diff-button')?.addEventListener('click', () => sendMessage('show-diff'));
  document.getElementById('reject-button')?.addEventListener('click', () => sendMessage('reject'));
  document.getElementById('apply-button')?.addEventListener('click', () => sendMessage('apply'));
  document.getElementById('toggle-apply')?.addEventListener('click', () => sendMessage('toggle-apply'));
  document.getElementById('copy-to-clipboard')?.addEventListener('click', () => sendMessage('copy-code'));
}

function sendMessage(command: string) {
  vscode.postMessage({ command });
}
