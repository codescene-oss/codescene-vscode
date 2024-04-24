import { provideVSCodeDesignSystem, vsCodeButton, vsCodeProgressRing } from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeProgressRing());

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('open-settings-button')?.addEventListener('click', () => sendMessage('open-settings'));
  document.getElementById('open-settings-link')?.addEventListener('click', () => sendMessage('open-settings'));
  document
    .getElementById('auto-refactor-link')
    ?.addEventListener('click', () => sendMessage('focus-explorer-ace-view'));
  document.getElementById('problems-panel-link')?.addEventListener('click', () => sendMessage('focus-problems-view'));
  document.getElementById('explorer-code-health-link')?.addEventListener('click', () => sendMessage('focus-explorer-code-health-view'));
  document.getElementById('clear-errors-button')?.addEventListener('click', () => sendMessage('clear-errors'));
  document
    .getElementById('show-codescene-log-link')
    ?.addEventListener('click', () => sendMessage('show-codescene-log-output'));
}
