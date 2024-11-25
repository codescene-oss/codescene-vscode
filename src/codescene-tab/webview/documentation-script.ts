import '@vscode-elements/elements/dist/vscode-button';

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('close-button')?.addEventListener('click', () => sendMessage('close'));
  document.getElementById('function-location')?.addEventListener('click', () => sendMessage('goto-function-location'));
  document
    .getElementById('refactoring-button')
    ?.addEventListener('click', () => sendMessage('request-and-present-refactoring'));
}
