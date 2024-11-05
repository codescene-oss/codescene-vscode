window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string, data?: object) {
  vscode.postMessage({ command, ...data });
}

function main() {
  const chError = document.getElementById('code-health-analysis-badge');
  addClickEventForClass(chError, 'badge-error', () => sendMessage('show-code-health-analysis-error'));

  const aceError = document.getElementById('ace-badge');
  addClickEventForClass(aceError, 'badge-error', () => sendMessage('show-ace-error'));

  document.getElementById('upgrade-link')?.addEventListener('click', () => sendMessage('open-ai-pricing'));
  document.getElementById('codescene-settings')?.addEventListener('click', () => sendMessage('open-settings'));
  document.getElementById('documentation')?.addEventListener('click', () => sendMessage('open-documentation'));
  document
    .getElementById('terms-and-policies')
    ?.addEventListener('click', () => sendMessage('open-terms-and-policies'));

  document
    .getElementById('privacy-principles')
    ?.addEventListener('click', () => sendMessage('open-ai-privacy-principles'));
  document.getElementById('contact-codescene')?.addEventListener('click', () => sendMessage('open-contact-codescene'));
  document.getElementById('support-ticket-link')?.addEventListener('click', () => sendMessage('raise-support-ticket'));

  document.getElementById('machine-id')?.addEventListener('click', () => sendMessage('copy-machine-id'));
}

function addClickEventForClass(element: HTMLElement | null, className: string, handler: () => void) {
  if (element?.classList.contains(className)) {
    element.addEventListener('click', handler);
  }
}
