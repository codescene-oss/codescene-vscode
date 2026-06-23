import vscode from 'vscode';
import { CsExtensionState } from '../../cs-extension-state';
import {
  convertCWFCommitBaselineToVSCode,
  getFileAndFunctionFromState,
  getFunctionPosition,
} from '../../centralized-webview-framework/cwf-parsers';
import { HomeView } from './home-view';
import { showDocAtPosition } from '../../utils';
import { findOrOpenDocument, toDocsParamsRanged } from '../../documentation/commands';
import Telemetry from '../../telemetry';
import { getExtensionSettingsFilter } from '../../extension-id';
import { getMessageCategory } from './cwf-message-categories';
import {
  CommitBaselineType,
  MessageToIDEType,
  OpenDocsMessage,
} from '../../centralized-webview-framework/types/messages';
import { FileMetaType } from '../../centralized-webview-framework/types';
import { FunctionInfoExternal } from '../../centralized-webview-framework/types/delta';
import { CodeSmell } from '../../devtools-api/review-model';
import { logOutputChannel } from '../../log';

/**
 * Changes the commit baseline
 * @param commitBaseLineString
 */
async function handleSelectCommitBaseLineMessage(commitBaseLineString: CommitBaselineType) {
  const currentBaseline = CsExtensionState.baseline;
  const newBaseline = convertCWFCommitBaselineToVSCode(commitBaseLineString);
  if (newBaseline !== currentBaseline) {
    await CsExtensionState.setBaseline(newBaseline);
  }
}

/**
 * Finds position data fora. function and opens the function in editor
 * @param homeView
 * @param payload
 */
async function handleGoToFunction(homeView: HomeView, payload: FileMetaType) {
  const foundFileFunction = getFileAndFunctionFromState(homeView.getFileIssueMap(), payload.fileName);
  foundFileFunction?.file &&
    (await showDocAtPosition(foundFileFunction.file.document, getFunctionPosition(payload.fn)));
}


/**
 * Opens docs panel for a codesmell
 * @param homeView
 * @param payload
 * @returns
 */
function handleOpenDocs(homeView: HomeView, payload: OpenDocsMessage['payload']) {
  const foundFileFunction = getFileAndFunctionFromState(
    homeView.getFileIssueMap(),
    payload.fileName,
    payload.fn
      ? {
          name: payload.fn.name,
          startLine: payload.fn.range?.startLine || 0,
        }
      : undefined
  );
  if (!foundFileFunction) return;

  const docsParams = toDocsParamsRanged(
    payload.docType,
    foundFileFunction.file?.document,
    {
      'highlight-range': {
        'start-line': payload.fn?.range?.startLine ?? 1,
        'start-column': payload.fn?.range?.startColumn ?? 1,
        'end-line': payload.fn?.range?.endLine ?? 1,
        'end-column': payload.fn?.range?.endColumn ?? 1,
      },
    } as CodeSmell
  );
  if (docsParams) {
    void vscode.commands.executeCommand('codescene.openInteractiveDocsPanel', docsParams, 'code-health-details');
  }
}

/**
 * Open settings in editor
 */
function handleOpenSettings() {
  Telemetry.logUsage('control-center/open-settings');
  vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', getExtensionSettingsFilter()).then(
    () => {},
    (err) => {
      void vscode.commands.executeCommand('workbench.action.openSettings', getExtensionSettingsFilter());
    }
  );
}

/**
 * Change homeview state to display loginflow
 * @param homeView
 */
async function handleOpenLogin(homeView: HomeView) {
  await vscode.commands.executeCommand('codescene.signInCancel');
  homeView.setLoginFlowState({
    loginOpen: true,
    loginState: 'init',
  });
}

/**
 * Change homeview state to hide loginflow
 * @param homeView
 */
function handleCloseLogin(homeView: HomeView) {
  homeView.setLoginFlowState({
    loginOpen: false,
    loginState: 'init',
  });
}

/**
 * Initiate the login.
 * @param homeView
 * @param payload
 */
async function handleInitLogin(homeView: HomeView, payload: { baseUrl: string; type: 'cloud' | 'enterprise' }) {
  void vscode.commands.executeCommand('codescene.signIn');
  homeView.setLoginFlowState({
    loginOpen: true,
    loginState: 'pending',
  });
}

/**
 * Handles messages related to webview meta state
 * @param homeView
 * @param message
 * @returns
 */
function handleLifecyleMessage(homeView: HomeView, message: MessageToIDEType) {
  switch (message.messageType) {
    case 'init':
      homeView.setInitiated(true);
      return;
  }
}

/**
 * Handles messages related to loginflow or from the login view
 * @param homeView
 * @param message
 * @returns
 */
async function handleLoginMessage(homeView: HomeView, message: MessageToIDEType) {
  switch (message.messageType) {
    case 'open-login':
      await handleOpenLogin(homeView);
      return;
    case 'open-home':
      handleCloseLogin(homeView);
      return;
    case 'init-login':
      await handleInitLogin(homeView, message.payload);
      return;
  }
}

/**
 * Handles auto-refactor requests from the webview
 * @param homeView
 * @param payload
 * @returns
 */
async function handleAutoRefactor(homeView: HomeView, payload: { fileName: string; fn?: FunctionInfoExternal }) {
  const foundFileFunction = getFileAndFunctionFromState(
    homeView.getFileIssueMap(),
    payload.fileName,
    payload.fn ? { name: payload.fn.name, startLine: payload.fn.range?.startLine || 0 } : undefined
  );

  if (!foundFileFunction?.fn?.codeSmell) {
    logOutputChannel.warn('No code smell found for refactoring');
    return;
  }

  // Convert CWF codeSmell format to CodeSmell format expected by the command
  const codeSmell: CodeSmell = {
    category: foundFileFunction.fn.codeSmell.category,
    details: foundFileFunction.fn.codeSmell.details,
    'highlight-range': {
      'start-line': foundFileFunction.fn.codeSmell.highlightRange.startLine,
      'start-column': foundFileFunction.fn.codeSmell.highlightRange.startColumn,
      'end-line': foundFileFunction.fn.codeSmell.highlightRange.endLine,
      'end-column': foundFileFunction.fn.codeSmell.highlightRange.endColumn,
    },
  };

  const document = await findOrOpenDocument(vscode.Uri.file(payload.fileName));
  if (document) {
    await vscode.commands.executeCommand(
      'codescene.requestAndPresentRefactoring',
      document,
      'cwf-home',
      codeSmell
    );
  }
}

/**
 * Handling messages related to opening new panels
 * @param homeView
 * @param message
 * @returns
 */
async function handlePanelMessage(homeView: HomeView, message: MessageToIDEType) {
  switch (message.messageType) {
    case 'open-docs-for-function':
      handleOpenDocs(homeView, message.payload);
      return;
    case 'request-and-present-refactoring':
      await handleAutoRefactor(homeView, message.payload);
      return;
  }
}

/**
 * Handling messages related to native UI interactions
 * @param homeView
 * @param message
 * @returns
 */
async function handleEditorMessage(homeView: HomeView, message: MessageToIDEType) {
  switch (message.messageType) {
    case 'goto-function-location':
      await handleGoToFunction(homeView, message.payload);
      return;
    case 'open-settings':
      handleOpenSettings();
      return;
  }
}

/**
 * Handling messages related to CodeScene global state
 * @param homeView
 * @param message
 * @returns
 */
async function handleStateChangeMessage(homeView: HomeView, message: MessageToIDEType) {
  switch (message.messageType) {
    case 'commitBaseline':
      await handleSelectCommitBaseLineMessage(message.payload);
      return;
  }
}

/**
 * Handles all messages from the home view panel
 * @param homeView
 * @param message
 * @returns
 */
export async function handleCWFMessage(homeView: HomeView, message: MessageToIDEType) {
  switch (getMessageCategory(message.messageType)) {
    case 'lifecycle':
      handleLifecyleMessage(homeView, message);
      return;
    case 'login':
      await handleLoginMessage(homeView, message);
      return;
    case 'panel':
      await handlePanelMessage(homeView, message);
      return;
    case 'editor':
      await handleEditorMessage(homeView, message);
      return;
    case 'stateChange':
      await handleStateChangeMessage(homeView, message);
      return;
    default:
      console.warn(message.messageType, 'not supported yet');
  }
}
