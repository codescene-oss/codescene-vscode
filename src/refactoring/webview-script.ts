import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeDivider,
  vsCodeProgressRing,
  vsCodeTag,
} from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider(), vsCodeProgressRing(), vsCodeTag());

const vscode = acquireVsCodeApi();

window.addEventListener('load', main);

function main() {
  document.getElementById('reject-button')?.addEventListener('click', () => sendMessage('reject'));
  document.getElementById('apply-button')?.addEventListener('click', () => sendMessage('apply'));
}

function sendMessage(command: string) {
  vscode.postMessage({ command });
}
