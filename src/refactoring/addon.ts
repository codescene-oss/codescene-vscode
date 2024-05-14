// Functions for handling enabling and disabling the ACE "addon" components
import { AxiosError } from 'axios';
import vscode, { Diagnostic } from 'vscode';
import { getConfiguration } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { CsRestApi } from '../cs-rest-api';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { toDistinctLanguageIds } from '../language-support';
import { CsRefactoringCommands } from './commands';
import { CsRefactoringRequests } from './cs-refactoring-requests';
import { PreFlightResponse } from './model';

/**
 * Work in progress API just to keep us from creating too many contact points between
 * the ACE functionality and the rest of the extension
 */
export interface AceAPI {
  enableACE: (context: vscode.ExtensionContext, cliPath: string) => Promise<PreFlightResponse>;
  disableACE: () => void;
  onDidChangeRequests: vscode.Event<void>;
  onDidRequestFail: vscode.Event<Error | AxiosError>;
}

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
async function enableACE(context: vscode.ExtensionContext, cliPath: string) {
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
    const refactoringSelector = toRefactoringDocumentSelector(preflightResponse.supported['file-types']);
    const codeSmellFilter = createCodeSmellsFilter(preflightResponse);

    const commandDisposable = new CsRefactoringCommands(
      context.extensionUri,
      cliPath,
      refactoringSelector,
      codeSmellFilter,
      preflightResponse['max-input-loc']
    );
    aceDisposables.push(commandDisposable);

    // Collect all disposables used by the refactoring features
    // const codeLensProvider = new CsRefactorCodeLensProvider(codeSmellFilter);
    // aceDisposables.push(codeLensProvider);
    // aceDisposables.push(vscode.languages.registerCodeLensProvider(refactoringSelector, codeLensProvider));

    // aceDisposables.push(
    //   vscode.languages.registerCodeActionsProvider(refactoringSelector, new CsRefactorCodeAction(codeSmellFilter), {
    //     providedCodeActionKinds: CsRefactorCodeAction.providedCodeActionKinds,
    //   })
    // );

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
  CsRefactoringRequests.deleteAll();
}

export type DiagnosticFilter = (d: Diagnostic) => boolean;

function createCodeSmellsFilter(refactorCapabilities: PreFlightResponse): DiagnosticFilter {
  return (d: Diagnostic) =>
    d.code instanceof Object && refactorCapabilities.supported['code-smells'].includes(d.code.value.toString());
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
