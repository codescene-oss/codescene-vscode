import '@vscode-elements/elements/dist/vscode-button';
import { VscodeButton } from '@vscode-elements/elements/dist/vscode-button';

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
    window.addEventListener('message', refactoringButtonHandler(refactoringButton as VscodeButton));
  }
}

function refactoringButtonHandler(refactoringButton: VscodeButton) {
  return (event: MessageEvent<any>) => {
    const { command } = event.data;
    refactoringButton.iconSpin = false;
    if (command === 'refactoring-ok') {
      refactoringButton.icon = 'sparkle';
    } else if (command === 'refactoring-failed') {
      refactoringButton.secondary = true;
      refactoringButton.disabled = true;
      refactoringButton.icon = 'circle-slash';
    }
  };
}
