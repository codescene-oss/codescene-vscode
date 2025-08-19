// CS-5069 Remove ACE from public version
// import '@vscode-elements/elements/dist/vscode-button';
// import '@vscode-elements/elements/dist/vscode-progress-ring';

// window.addEventListener('load', main);

// const vscode = acquireVsCodeApi();

// function sendMessage(command: string) {
//   vscode.postMessage({ command });
// }

// function main() {
//   addClickEventListener('close-button', 'close');
//   addClickEventListener('function-location', 'gotoFunctionLocation');
//   addClickEventListener('diff-button', 'showDiff');
//   addClickEventListener('reject-button', 'reject');
//   addClickEventListener('apply-button', 'apply');
//   addClickEventListener('retry-button', 'retry');
//   addClickEventListener('copy-to-clipboard-button', 'copyCode');
//   addClickEventListener('show-logoutput-link', 'showLogoutput');
// }

// function addClickEventListener(elementId: string, command: string) {
//   const buttonEl = document.getElementById(elementId);
//   buttonEl?.addEventListener('click', () => sendMessage(command));
// }
