import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton());

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('function-location')?.addEventListener('click', () => sendMessage('goto-function-location'));
  addCollapseExpandHandling('example');
  addCollapseExpandHandling('solution');
  const refactoringButton = document.getElementById('refactoring-button');
  refactoringButton?.addEventListener('click', () => sendMessage('show-refactoring'));

  window.addEventListener('message', (event) => {
    const { command, args } = event.data;
    if (command === 'show-refactor-button') {
      args[0] ? refactoringButton?.classList.remove('hidden') : refactoringButton?.classList.add('hidden');
    }
  });
}

function addCollapseExpandHandling(title: string) {
  const header = document.getElementsByClassName(`${title}-header`).item(0);
  if (!header) return;
  const container = (document.getElementsByClassName(`${title}-container`) as HTMLCollectionOf<HTMLDivElement>).item(0);
  header.addEventListener('click', () => {
    header.firstElementChild?.classList.toggle('rotated');
    container?.classList.toggle('collapsed');
  });
}