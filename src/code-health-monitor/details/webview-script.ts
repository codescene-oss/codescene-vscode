import '@vscode-elements/elements/dist/vscode-button';
import { VscodeButton } from '@vscode-elements/elements/dist/vscode-button';

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string, data?: object) {
  vscode.postMessage({ command, ...data });
}

function main() {
  // CS-5069 Remove ACE from public version
  // document.getElementById('refactoring-button')?.addEventListener('click', () => sendMessage('request-and-present-refactoring'));

  for (const link of Array.from(document.getElementsByClassName('issue-link'))) {
    link.addEventListener('click', (e) => issueClickHandler(e));
  }
}

function issueClickHandler(event: Event) {
  const issueIndex = Number((event.currentTarget as HTMLElement).getAttribute('issue-index'));
  sendMessage('interactive-docs', { issueIndex });
}