import vscode from 'vscode';

let gitAvailable = true;
let gitUnavailableEventEmitted = false;

const gitDetectedAsUnavailableEmitter = new vscode.EventEmitter<void>();
export const onGitDetectedAsUnavailable = gitDetectedAsUnavailableEmitter.event;

export function markGitAsUnavailable(): void {
  gitAvailable = false;
  if (!gitUnavailableEventEmitted) {
    gitUnavailableEventEmitted = true;
    gitDetectedAsUnavailableEmitter.fire();
  }
}
