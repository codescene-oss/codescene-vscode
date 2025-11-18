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
import { getMessageCategory } from './cwf-message-categories';
import {
  CommitBaselineType,
  MessageToIDEType,
  OpenDocsMessage,
} from '../../centralized-webview-framework/types/messages';
import { FileMetaType } from '../../centralized-webview-framework/types';
import { CodeSmell } from '../../devtools-api/review-model';

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
 * NYI: Find function in VSCode state and trigger autorefactor panel
 * @param payload
 */
async function handleAutoRefactor(homeView: HomeView, payload: any) {
  const document = await findOrOpenDocument(payload.fileName);
  const foundFileFunction = getFileAndFunctionFromState(homeView.getFileIssueMap(), payload.fileName, {
    name: payload.fn.name,
    startLine: payload.fn.range.startLine,
  });

  if (!foundFileFunction?.fnToRefactor) return;

  void vscode.commands.executeCommand(
    'codescene.requestAndPresentRefactoring',
    document,
    'code-health-details',
    foundFileFunction?.fnToRefactor
  );
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
    } as CodeSmell,
    { fnToRefactor: foundFileFunction.fnToRefactor }
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
  vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', '@ext:codescene.codescene-vscode').then(
    () => {},
    (err) => {
      void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codescene.codescene-vscode');
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
 * Initiate the login flow first checking if the baseUrl has been changed by the user (Enterprise)
 * @param homeView
 * @param payload
 */
async function handleInitLogin(homeView: HomeView, payload: { baseUrl: string; type: 'cloud' | 'enterprise' }) {
  const cfg = vscode.workspace.getConfiguration('codescene');
  const currentServerUrl = cfg.get('serverUrl');
  if (payload.baseUrl !== currentServerUrl) {
    await cfg.update('serverUrl', payload.baseUrl, vscode.ConfigurationTarget.Workspace);
  }
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
 * Handling messages related to opening new panels
 * @param homeView
 * @param message
 * @returns
 */
function handlePanelMessage(homeView: HomeView, message: MessageToIDEType) {
  switch (message.messageType) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    case 'request-and-present-refactoring':
      void handleAutoRefactor(homeView, message.payload);
      return;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    case 'open-docs-for-function':
      handleOpenDocs(homeView, message.payload);
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
      handlePanelMessage(homeView, message);
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
