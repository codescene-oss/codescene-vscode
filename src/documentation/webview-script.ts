import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton());

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('function-location')?.addEventListener('click', () => sendMessage('goto-function-location'));

  const refactoringButton = document.getElementById('refactoring-button');
  refactoringButton?.addEventListener('click', () => sendMessage('initiate-refactoring'));

  window.addEventListener('message', (event) => {
    const { command, args } = event.data;
    if (command === 'show-refactor-button') {
      args[0] ? refactoringButton?.classList.remove('hidden') : refactoringButton?.classList.add('hidden');
    }
  });
}
