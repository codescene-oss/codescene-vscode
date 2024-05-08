// Functions for handling enabling and disabling the ACE "addon" components
import vscode from 'vscode';
import { getConfiguration } from '../configuration';
import CsDiagnostics from '../cs-diagnostics';
import { CsExtensionState } from '../cs-extension-state';
import { CsRestApi } from '../cs-rest-api';
import { toDistinctLanguageIds } from '../language-support';
import { CsRefactorCodeAction } from './codeaction';
import { CsRefactorCodeLensProvider } from './codelens';
import { CsRefactoringCommands } from './commands';
import { CsRefactoringRequests } from './cs-refactoring-requests';
import { RefactoringsView } from './refactorings-view';
import { createCodeSmellsFilter } from './utils';

const aceDisposables: vscode.Disposable[] = [];

/**
 * If config is enabled and we have a session, try to enable ACE capabilities by getting a preflight response.
 * If disabled manually by the config option, the capabilities are disabled with an appropriate message.
 *
 * @param context
 */
export async function enableACE(context: vscode.ExtensionContext, cliPath: string) {
  // Make sure to clear the capabilities first, disposing components, so we don't accidentally get multiple codelenses etc.
  disableACE();

  const enableACE = getConfiguration('enableAutoRefactor');
  if (!enableACE) {
    return Promise.reject('Auto-refactor disabled in configuration');
  }

  if (!CsExtensionState.stateProperties.session) {
    return Promise.reject('Not signed in');
  }

  return CsRestApi.instance.fetchRefactorPreflight().then((preflightResponse) => {
    const refactoringSelector = toRefactoringDocumentSelector(preflightResponse.supported['file-types']);
    const codeSmellFilter = createCodeSmellsFilter(preflightResponse);

    // This command is registered here, but will act as a noop until it gets enabled with help of an appropriate preflight
    // response, see below (enableRequestRefactoringsCmd)
    const commandDisposable = new CsRefactoringCommands(
      context.extensionUri,
      cliPath,

      refactoringSelector,
      codeSmellFilter,
      preflightResponse['max-input-loc']
    );
    aceDisposables.push(commandDisposable);

    // Collect all disposables used by the refactoring features
    const codeLensProvider = new CsRefactorCodeLensProvider(codeSmellFilter);
    aceDisposables.push(codeLensProvider);
    aceDisposables.push(vscode.languages.registerCodeLensProvider(refactoringSelector, codeLensProvider));

    aceDisposables.push(
      vscode.languages.registerCodeActionsProvider(refactoringSelector, new CsRefactorCodeAction(codeSmellFilter), {
        providedCodeActionKinds: CsRefactorCodeAction.providedCodeActionKinds,
      })
    );

    aceDisposables.push(new RefactoringsView());

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

export function disableACE() {
  aceDisposables.forEach((d) => d.dispose());
  aceDisposables.length = 0;
  CsRefactoringRequests.deleteAll();
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
