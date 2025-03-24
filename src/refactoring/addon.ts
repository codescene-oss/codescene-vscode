// Functions for handling enabling and disabling the ACE "addon" components
import { AxiosError } from 'axios';
import vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { CsFeature } from '../cs-extension-state';
import { DevtoolsAPI } from '../devtools-api';
import { logOutputChannel } from '../log';
import { assertError, reportError } from '../utils';
import { CsRefactoringCommands } from './commands';
import { RefactoringRequest } from './request';
import { createTmpDiffUriScheme } from './utils';

/**
 * Work in progress API just to keep us from creating too many contact points between
 * the ACE functionality and the rest of the extension
 */
export interface AceAPI {
  onDidChangeState: vscode.Event<CsFeature>;
  onDidRefactoringRequest: vscode.Event<AceRequestEvent>;
  onDidRequestFail: vscode.Event<Error>;
}

export type AceRequestEvent = {
  document: vscode.TextDocument;
  type: 'start' | 'end';
  request: RefactoringRequest;
};

/**
 * Aside from the AceAPI, this "addon" also contributes
 * the codescene.ace.activate command
 */
export function activate(context: vscode.ExtensionContext): AceAPI {
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.ace.activate', () => {
      const enableACE = getConfiguration('enableAutoRefactor');
      if (!enableACE) {
        disable();
        return;
      }
      void enable(context);
    })
  );

  return {
    onDidChangeState: stateEmitter.event,
    onDidRefactoringRequest: RefactoringRequest.onDidRefactoringRequest,
    onDidRequestFail: RefactoringRequest.onDidRequestFail,
  };
}

const aceDisposables: vscode.Disposable[] = [];
const stateEmitter = new vscode.EventEmitter<CsFeature>();
/**
 * If config is enabled and we have a session, try to enable ACE capabilities by getting a preflight response.
 * If disabled manually by the config option, the capabilities are disabled with an appropriate message.
 *
 * @param context
 */
async function enable(context: vscode.ExtensionContext) {
  stateEmitter.fire({ state: 'loading' });

  try {
    await DevtoolsAPI.preflight();

    // Make sure to dispose old commands and diff uri scheme so we won't get duplicates (same as in disable())
    aceDisposables.forEach((d) => d.dispose());
    aceDisposables.length = 0;

    aceDisposables.push(new CsRefactoringCommands());
    aceDisposables.push(createTmpDiffUriScheme());

    /* Add disposables to both subscription context and the extension state list
     * of disposables. This is to ensure they're disposed either when the extension
     * is deactivated or if the online features are disabled */
    context.subscriptions.push(...aceDisposables);

    stateEmitter.fire({ state: 'enabled' });
    logOutputChannel.info('ACE enabled!');
  } catch (e) {
    const error = assertError(e) || new Error('Unknown error');
    stateEmitter.fire({ state: 'error', error });
    reportError('Unable to enable refactoring capabilities', error);
  }
}

function disable() {
  aceDisposables.forEach((d) => d.dispose());
  aceDisposables.length = 0;
  DevtoolsAPI.disableAce();
  stateEmitter.fire({ state: 'disabled' });
  logOutputChannel.info('ACE disabled!');
}
