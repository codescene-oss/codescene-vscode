import '@vscode-elements/elements/dist/vscode-button';

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('function-location')?.addEventListener('click', () => sendMessage('goto-function-location'));
  document
    .getElementById('acknowledge-button')
    ?.addEventListener('click', () => sendMessage('acknowledged'));
}
