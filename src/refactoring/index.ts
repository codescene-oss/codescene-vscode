import vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { DevtoolsAPI } from '../devtools-api';
import Reviewer from '../review/reviewer';
import { CsRefactoringCommands } from './commands';
import { createTmpDiffUriScheme } from './utils';

/**
 * Initialize commands and diff scheme and try to enable ACE by requesting a preflight from the
 * Devtools API. Respects the enableAutoRefactor configuration setting.
 *
 * @param context
 */
export function initAce(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    new CsRefactoringCommands(),
    createTmpDiffUriScheme(),
    DevtoolsAPI.onDidChangePreflightState((event) => {
      CsExtensionState.setACEState(event);
      // Refresh deltas to add/remove refactorable functions from the code health monitor when ace state changes
      if (event.state === 'enabled' || event.state === 'disabled') {
        Reviewer.instance.refreshDeltas();
      }
    })
  );

  enableAce();
}

export function enableAce() {
  const enableACE = getConfiguration('enableAutoRefactor');
  if (!enableACE) {
    DevtoolsAPI.disableAce();
    return;
  }
  void DevtoolsAPI.preflight();
}

export function disableAce() {
  DevtoolsAPI.disableAce();
}
