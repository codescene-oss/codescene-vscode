import '@vscode-elements/elements/dist/vscode-button';
import '@vscode-elements/elements/dist/vscode-progress-ring';

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('function-location')?.addEventListener('click', () => sendMessage('gotoFunctionLocation'));
  document.getElementById('diff-button')?.addEventListener('click', () => sendMessage('showDiff'));
  document.getElementById('reject-button')?.addEventListener('click', () => sendMessage('reject'));
  document.getElementById('apply-button')?.addEventListener('click', () => sendMessage('apply'));
  document.getElementById('retry-button')?.addEventListener('click', () => sendMessage('retry'));
  document.getElementById('copy-to-clipboard-button')?.addEventListener('click', () => sendMessage('copyCode'));
  document.getElementById('show-logoutput-link')?.addEventListener('click', () => sendMessage('showLogoutput'));
}
