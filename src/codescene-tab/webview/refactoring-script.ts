import { provideVSCodeDesignSystem, vsCodeButton, vsCodeProgressRing } from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeProgressRing());

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('function-location')?.addEventListener('click', () => sendMessage('goto-function-location'));
  document.getElementById('diff-button')?.addEventListener('click', () => sendMessage('show-diff'));
  document.getElementById('reject-button')?.addEventListener('click', () => sendMessage('reject'));
  document.getElementById('apply-button')?.addEventListener('click', () => sendMessage('apply'));
  document.getElementById('copy-to-clipboard-button')?.addEventListener('click', () => sendMessage('copy-code'));
  document.getElementById('show-logoutput-link')?.addEventListener('click', () => sendMessage('show-logoutput'));
}
