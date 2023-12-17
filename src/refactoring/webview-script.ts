import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton());

const vscode = acquireVsCodeApi();

window.addEventListener('load', main);

function main() {
  document.getElementById('reject-button')?.addEventListener('click', () => sendMessage('reject'));
  document.getElementById('apply-button')?.addEventListener('click', () => sendMessage('apply'));
}

function sendMessage(command: string) {
  vscode.postMessage({ command });
}
