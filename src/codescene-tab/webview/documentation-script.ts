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
  refactoringButton?.addEventListener('click', () => sendMessage('show-refactoring'));

  if (refactoringButton) {
    window.addEventListener('message', refactoringButtonHandler(refactoringButton));
  }
}

function refactoringButtonHandler(refactoringButton: HTMLElement) {
  return (event: MessageEvent<any>) => {
    const { command } = event.data;
    const iconSpan = refactoringButton.querySelector('span');
    if (!iconSpan) return;
    iconSpan.classList.remove('codicon-loading', 'codicon-modifier-spin');
    if (command === 'refactoring-ok') {
      iconSpan.classList.add('codicon-sparkle');
    } else if (command === 'refactoring-failed') {
      iconSpan.classList.add('codicon-circle-slash');
      refactoringButton.setAttribute('disabled', 'true');
    }
  };
}
