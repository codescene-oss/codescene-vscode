import vscode from 'vscode';
import { getConfiguration, onDidChangeConfiguration } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { aceUsable, DevtoolsAPI } from '../devtools-api';
import { logOutputChannel } from '../log';
import { CsRefactoringCommands } from './commands';
import { initProviderSecrets, migrateProviderApiKeysFromSettings, promptForProviderApiKey } from './provider-secrets';
import { createTmpDiffUriScheme } from './utils';

/**
 * Initialize commands and diff scheme and enable ACE.
 * Provides the codescene.ace.setEnabled command to enable/disable ACE, which respects
 * the enableAutoRefactor configuration setting.
 *
 * @param context
 */
export const ACE_USABLE_CONTEXT_KEY = 'codescene.aceUsable';

function updateAceUsableContext() {
  void vscode.commands.executeCommand('setContext', ACE_USABLE_CONTEXT_KEY, aceUsable());
}

async function migrateApiKeys() {
  try {
    const moved = await migrateProviderApiKeysFromSettings();
    if (moved > 0) {
      void vscode.window.showInformationMessage(
        'CodeScene moved your Refactoring Agent API keys from settings.json to VS Code secure storage.'
      );
    }
  } catch (e) {
    logOutputChannel.error(`Could not move Refactoring Agent API keys to secure storage: ${e}`);
  }
}

export function initAce(context: vscode.ExtensionContext) {
  initProviderSecrets(context.secrets);
  void migrateApiKeys();
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.setProviderApiKey', promptForProviderApiKey),
    CsExtensionState.onAceStateChanged(updateAceUsableContext),
    CsExtensionState.onAuthChanged(updateAceUsableContext),
    onDidChangeConfiguration('authToken', updateAceUsableContext),
    vscode.commands.registerCommand('codescene.ace.setEnabled', (enable = true) => {
      enable ? enableAce() : disableAce();
    }),
    new CsRefactoringCommands(),
    createTmpDiffUriScheme(),
    DevtoolsAPI.onDidChangeAceState((event) => {
      CsExtensionState.setACEState(event);
    })
  );

  enableAce();
  updateAceUsableContext();
}

function enableAce() {
  const enableACE = getConfiguration('enableAutoRefactor');
  if (!enableACE) {
    DevtoolsAPI.disableAce();
    return;
  }
  DevtoolsAPI.enableAce();
  logOutputChannel.info('ACE enabled!');
}

function disableAce() {
  DevtoolsAPI.disableAce();
}
