import {
  provideVSCodeDesignSystem,
  vsCodeButton,
} from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton());

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('open-settings-button')?.addEventListener('click', () => sendMessage('open-settings'));
  document.getElementById('open-settings-link')?.addEventListener('click', () => sendMessage('open-settings'));
  document.getElementById('change-coupling-link')?.addEventListener('click', () => sendMessage('focus-change-coupling-explorer-view'));
  document.getElementById('auto-refactor-link')?.addEventListener('click', () => sendMessage('focus-explorer-ace-view'));
}