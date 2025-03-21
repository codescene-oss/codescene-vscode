window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string, data?: object) {
  vscode.postMessage({ command, ...data });
}

function main() {
  // Account
  addClickListenerToElementById('upgrade-link', () => sendMessage('openAiPricing'));

  // Status
  addClickEventForClass('code-health-analysis-badge', 'badge-error', () => sendMessage('showLogOutput'));
  addClickEventForClass('ace-badge', 'badge-error', () => sendMessage('retryAce'));

  // More
  addClickListenerToElementById('codescene-settings', () => sendMessage('openSettings'));
  addClickListenerToElementById('documentation', () => sendMessage('openDocumentation'));
  addClickListenerToElementById('terms-and-policies', () => sendMessage('openTermsAndPolicies'));
  addClickListenerToElementById('privacy-principles', () => sendMessage('openAiPrivacyPrinciples'));
  addClickListenerToElementById('contact-codescene', () => sendMessage('openContactCodescene'));
  addClickListenerToElementById('support-ticket-link', () => sendMessage('raiseSupportTicket'));
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
