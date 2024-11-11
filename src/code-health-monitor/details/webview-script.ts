import '@vscode-elements/elements/dist/vscode-button';
import { VscodeButton } from '@vscode-elements/elements/dist/vscode-button';

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string, data?: object) {
  vscode.postMessage({ command, ...data });
}

function main() {
  const refactoringButton = document.getElementById('refactoring-button');
  refactoringButton?.addEventListener('click', () => sendMessage('auto-refactor'));

  if (refactoringButton) {
    window.addEventListener('message', refactoringButtonHandler(refactoringButton as VscodeButton));
  }
  for (const link of Array.from(document.getElementsByClassName('issue-icon-link'))) {
    link.addEventListener('click', (e) => issueClickHandler(e));
  }
}

function issueClickHandler(event: Event) {
  const issueIndex = Number((event.currentTarget as HTMLElement).getAttribute('issue-index'));
  sendMessage('interactive-docs', { issueIndex });
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
