import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(vsCodeButton());

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string, data?: object) {
  vscode.postMessage({ command, ...data });
}

function main() {
  const refactoringButton = document.getElementById('refactoring-button');
  refactoringButton?.addEventListener('click', () => sendMessage('auto-refactor'));

  if (refactoringButton) {
    window.addEventListener('message', refactoringButtonHandler(refactoringButton));
  }
  for (const link of Array.from(document.getElementsByClassName('issue-icon-link'))) {
    link.addEventListener('click', (e) => issueClickHandler(e));
  }
}

function issueClickHandler(event: Event) {
  const issueIndex = Number((event.currentTarget as HTMLElement).getAttribute('issue-index'));
  sendMessage('interactive-docs', { issueIndex });
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
