window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string, data?: object) {
  vscode.postMessage({ command, ...data });
}

function main() {
  // Account
  addClickListenerToElementById('upgrade-link', () => sendMessage('open-ai-pricing'));

  // Status
  addClickEventForClass('code-health-analysis-badge', 'badge-error', () => sendMessage('show-code-health-analysis-error'));
  addClickEventForClass('ace-badge', 'badge-error', () => sendMessage('show-ace-error'));

  // More
  addClickListenerToElementById('codescene-settings', () => sendMessage('open-settings'));
  addClickListenerToElementById('documentation', () => sendMessage('open-documentation'));
  addClickListenerToElementById('terms-and-policies', () => sendMessage('open-terms-and-policies'));
  addClickListenerToElementById('privacy-principles', () => sendMessage('open-ai-privacy-principles'));
  addClickListenerToElementById('contact-codescene', () => sendMessage('open-contact-codescene'));
  addClickListenerToElementById('support-ticket-link', () => sendMessage('raise-support-ticket'));

  addClickListenerToElementById('machine-id', () => sendMessage('copy-machine-id'));
}

function addClickListenerToElementById(elementId: string, listener: () => void) {
  const element = document.getElementById(elementId);
  if (!element) throw new Error(`HTMLElement with id "${elementId}" not found`);
  element.addEventListener('click', listener);
}

function addClickEventForClass(elementId: string, className: string, handler: () => void) {
  const element = document.getElementById(elementId);
  if (element?.classList.contains(className)) {
    element.addEventListener('click', handler);
  }
}
