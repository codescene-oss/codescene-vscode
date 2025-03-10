// Functions for handling enabling and disabling the ACE "addon" components
import { AxiosError } from 'axios';
import vscode from 'vscode';
import { AceFeature } from '../cs-extension-state';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { logOutputChannel } from '../log';
import { assertError, reportError } from '../utils';
import { RefactoringAPI } from './api';
import { RefactoringCapabilities } from './capabilities';
import { CsRefactoringCommands } from './commands';
import { RefactoringRequest } from './request';
import { createTmpDiffUriScheme } from './utils';
import { DevtoolsAPI } from '../devtools-interop/api';
import { getConfiguration } from '../configuration';

/**
 * Work in progress API just to keep us from creating too many contact points between
 * the ACE functionality and the rest of the extension
 */
export interface AceAPI {
  onDidChangeState: vscode.Event<AceFeature>;
  onDidRefactoringRequest: vscode.Event<AceRequestEvent>;
  onDidRequestFail: vscode.Event<Error | AxiosError>;
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
export function activate(context: vscode.ExtensionContext, devtoolsApi: DevtoolsAPI): AceAPI {
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.ace.activate', () => {
      const enableACE = getConfiguration('enableAutoRefactor');
      if (!enableACE) {
        disable();
        return;
      }
      void enable(context, devtoolsApi);
    })
  );

  return {
    onDidChangeState: stateEmitter.event,
    onDidRefactoringRequest: RefactoringRequest.onDidRefactoringRequest,
    onDidRequestFail: RefactoringRequest.onDidRequestFail,
  };
}

const aceDisposables: vscode.Disposable[] = [];
const stateEmitter = new vscode.EventEmitter<AceFeature>();
/**
 * If config is enabled and we have a session, try to enable ACE capabilities by getting a preflight response.
 * If disabled manually by the config option, the capabilities are disabled with an appropriate message.
 *
 * @param context
 */
async function enable(context: vscode.ExtensionContext, devtoolsApi: DevtoolsAPI) {
  stateEmitter.fire({ state: 'loading' });

  try {
    const preflightResponse = await RefactoringAPI.instance.preFlight();
    const capabilities = new RefactoringCapabilities(preflightResponse, devtoolsApi);

    // Make sure to dispose old commands and diff uri scheme so we won't get duplicates (same as in disable())
    aceDisposables.forEach((d) => d.dispose());
    aceDisposables.length = 0;

    aceDisposables.push(new CsRefactoringCommands());
    aceDisposables.push(createTmpDiffUriScheme());

    /* Add disposables to both subscription context and the extension state list
     * of disposables. This is to ensure they're disposed either when the extension
     * is deactivated or if the online features are disabled */
    context.subscriptions.push(...aceDisposables);

    // Force update diagnosticCollection to request initial refactorings
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      CsDiagnostics.review(document);
    });
    stateEmitter.fire({ state: 'enabled', refactorCapabilities: capabilities });

    logOutputChannel.info('ACE enabled!');
    return capabilities;
  } catch (e) {
    const error = assertError(e) || new Error('Unknown error');
    stateEmitter.fire({ state: 'error', error });
    reportError('Unable to enable refactoring capabilities', error);
  }
}

function disable() {
  aceDisposables.forEach((d) => d.dispose());
  aceDisposables.length = 0;
  stateEmitter.fire({ state: 'disabled' });
  logOutputChannel.info('ACE disabled!');
}
