import vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { DevtoolsAPI } from '../devtools-api';
import { logOutputChannel } from '../log';
import Reviewer from '../review/reviewer';
import { CsRefactoringCommands } from './commands';
import { createTmpDiffUriScheme } from './utils';

/**
 * Initialize commands and diff scheme and try to enable ACE by requesting a preflight from the
 * Devtools API.
 * Provides the codescene.ace.setEnabled command to enable/disable ACE, which respects
 * the enableAutoRefactor configuration setting.
 *
 * @param context
 */
export function initAce(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.ace.setEnabled', (enable = true) => {
      enable ? void enableAce() : disableAce();
    }),
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

  void enableAce();
}

async function enableAce() {
  const enableACE = getConfiguration('enableAutoRefactor');
  if (!enableACE) {
    DevtoolsAPI.disableAce();
    return;
  }
  const preflight = await DevtoolsAPI.preflight();
  if (preflight) logOutputChannel.info('ACE enabled!');
}

function disableAce() {
  DevtoolsAPI.disableAce();
}
