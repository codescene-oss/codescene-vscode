import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton());

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('refactoring-button')?.addEventListener('click', () => sendMessage('initiate-refactoring'));
}
