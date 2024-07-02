// Functions for handling enabling and disabling the ACE "addon" components
import { AxiosError } from 'axios';
import vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { CsRestApi } from '../cs-rest-api';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { toDistinctLanguageIds } from '../language-support';
import { CsRefactoringCommands } from './commands';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';
import { PreFlightResponse } from './model';

/**
 * Work in progress API just to keep us from creating too many contact points between
 * the ACE functionality and the rest of the extension
 */
export interface AceAPI {
  enableACE: (context: vscode.ExtensionContext) => Promise<PreFlightResponse>;
  disableACE: () => void;
  onDidChangeRequests: vscode.Event<AceRequestEvent>;
  onDidRequestFail: vscode.Event<Error | AxiosError>;
}

export type AceRequestEvent = {
  document: vscode.TextDocument;
  type: 'start' | 'end';
  request?: CsRefactoringRequest;
  requests?: CsRefactoringRequest[];
};

/**
 * Aside from the AceAPI, this "addon" also contributes these commands from commands.ts:
 *  - codescene.requestRefactorings
 *  - codescene.presentRefactoring
 */
export function activate(): AceAPI {
  return {
    enableACE,
    disableACE,
    onDidChangeRequests: CsRefactoringRequests.onDidChangeRequests,
    onDidRequestFail: CsRefactoringRequests.onDidRequestFail,
  };
}

const aceDisposables: vscode.Disposable[] = [];

/**
 * If config is enabled and we have a session, try to enable ACE capabilities by getting a preflight response.
 * If disabled manually by the config option, the capabilities are disabled with an appropriate message.
 *
 * @param context
 */
async function enableACE(context: vscode.ExtensionContext) {
  // Make sure to clear the capabilities first, disposing components, so we don't accidentally get multiple commands etc.
  disableACE();

  const enableACE = getConfiguration('enableAutoRefactor');
  if (!enableACE) {
    return Promise.reject('Auto-refactor disabled in configuration');
  }

  if (!CsExtensionState.stateProperties.session) {
    const message = 'Not signed in';
    void vscode.window.showErrorMessage(`Unable to enable refactoring capabilities. ${message}`);
    return Promise.reject(message);
  }

  return CsRestApi.instance.fetchRefactorPreflight().then((preflightResponse) => {
    const commandDisposable = new CsRefactoringCommands(context.extensionUri, preflightResponse);
    aceDisposables.push(commandDisposable);

    /* Add disposables to both subscription context and the extension state list
     * of disposables. This is to ensure they're disposed either when the extension
     * is deactivated or if the online features are disabled */
    context.subscriptions.push(...aceDisposables);

    // Force update diagnosticCollection to request initial refactorings
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      CsDiagnostics.review(document);
    });

    return preflightResponse;
  });
}

function disableACE() {
  aceDisposables.forEach((d) => d.dispose());
  aceDisposables.length = 0;
}

/**
 *
 * @param refactoringSupport
 * @returns A list of distinct DocumentSelectors for the supported file types
 */
function toRefactoringDocumentSelector(supportedFileTypes: string[]): vscode.DocumentSelector {
  return toDistinctLanguageIds(supportedFileTypes).map((language) => ({
    language,
    scheme: 'file',
  }));
}

export { toRefactoringDocumentSelector }; // For test only
