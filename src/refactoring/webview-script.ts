import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeDivider,
  vsCodeProgressRing
} from '@vscode/webview-ui-toolkit';
import loadingMessages from './loading-messages';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider(), vsCodeProgressRing());

window.addEventListener('load', main);

const vscode = acquireVsCodeApi();

function sendMessage(command: string) {
  vscode.postMessage({ command });
}

function main() {
  document.getElementById('diff-button')?.addEventListener('click', () => sendMessage('show-diff'));
  document.getElementById('reject-button')?.addEventListener('click', () => sendMessage('reject'));
  document.getElementById('apply-button')?.addEventListener('click', () => sendMessage('apply'));
  document.getElementById('copy-to-clipboard-button')?.addEventListener('click', () => sendMessage('copy-code'));

  const loadingEl = document.getElementById('loading-span');
  if (loadingEl) {
    timedUpdate(loadingEl);
  }
}

let usedIndices: number[] = [];
function timedUpdate(loadingEl: HTMLElement) {
  if (usedIndices.length === loadingMessages.length) {
    usedIndices = [];
  }
  let ix = Math.floor(Math.random() * loadingMessages.length);
  while (usedIndices.includes(ix)) {
    ix = Math.floor(Math.random() * loadingMessages.length);
  }
  const msg = loadingMessages[ix];
  usedIndices.push(ix);

  loadingEl.innerHTML = msg;
  setTimeout(() => {
    timedUpdate(loadingEl);
  }, 2500 + Math.random() * 1500);
}
