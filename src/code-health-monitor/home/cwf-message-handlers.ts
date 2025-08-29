import vscode, { Disposable, ExtensionContext, Position, ViewBadge, Webview, WebviewViewProvider } from 'vscode';
import { CsExtensionState } from '../../cs-extension-state';
import {
  convertCWFCommitBaselineToVSCode,
  convertCWFDocTypeToVSCode,
  getFileAndFunctionFromState,
  getFunctionPosition,
} from './cwf-parsers';
import { CwfCommitBaselineType } from './cwf-types';
import { HomeView } from './home-view';
import { showDocAtPosition } from '../../utils';
import { toDocsParams } from '../../documentation/commands';
import Telemetry from '../../telemetry';

async function handleSelectCommitBaseLineMessage(commitBaseLineString: CwfCommitBaselineType) {
  const currentBaseline = CsExtensionState.baseline;
  const newBaseline = convertCWFCommitBaselineToVSCode(commitBaseLineString);
  if (newBaseline !== currentBaseline) {
    await CsExtensionState.setBaseline(newBaseline);
  }
}

async function handleGoToFunction(
  homeView: HomeView,
  payload: {
    fileName: string;
    fn?: { name: string; range?: { startLine: number; endLine: number; startColumn: number; endColumn: number } };
  }
) {
  const foundFileFunction = getFileAndFunctionFromState(homeView.getFileIssueMap(), payload.fileName);
  foundFileFunction?.file &&
    (await showDocAtPosition(foundFileFunction.file.document, getFunctionPosition(payload.fn)));
}

function handleAutoRefactor(payload: any) {
  console.log('Autorefactor NYI');
  // const foundFileFunction = getFileAndFunctionFromState(homeView.getFileIssueMap(), payload.fileName, {
  //   name: payload.fn.name,
  //   startLine: payload.fn.range.startLine,
  // });

  // if (!foundFileFunction) return;

  // void vscode.commands.executeCommand(
  //   'codescene.requestAndPresentRefactoring',
  //   foundFileFunction.file.document,
  //   'code-health-details',
  // );
}

function handleOpenDocs(homeView: HomeView, payload: any) {
  const foundFileFunction = getFileAndFunctionFromState(
    homeView.getFileIssueMap(),
    payload.fileName,
    payload.fn
      ? {
          name: payload.fn.name,
          startLine: payload.fn.range.startLine,
        }
      : undefined
  );
  if (!foundFileFunction) return;

  const docsParams = toDocsParams(
    convertCWFDocTypeToVSCode(payload.docType),
    foundFileFunction.file?.document,
    getFunctionPosition(payload.fn)
  );
  if (docsParams) {
    void vscode.commands.executeCommand('codescene.openInteractiveDocsPanel', docsParams, 'code-health-details');
  }
}

function handleOpenSettings() {
  Telemetry.logUsage('control-center/open-settings');
  vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', '@ext:codescene.codescene-vscode').then(
    () => {},
    (err) => {
      void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codescene.codescene-vscode');
    }
  );
}

function handleOpenLogin(homeView: HomeView) {
  homeView.setLoginFlowState({
    loginOpen: true,
    loginState: 'init',
  });
}
function handleCloseLogin(homeView: HomeView) {
  homeView.setLoginFlowState({
    loginOpen: false,
    loginState: 'init',
  });
}
function handleInitLogin(homeView: HomeView) {
  void vscode.commands.executeCommand('codescene.signIn');
  homeView.setLoginFlowState({
    loginOpen: true,
    loginState: 'pending',
  });
}

const lifecycleMessages = ['init'] as const;
const loginMessages = ['open-login', 'open-home', 'init-login'] as const;
const panelMessages = ['request-and-present-refactoring', 'open-docs-for-function'] as const;
const editorMessages = ['goto-function-location', 'open-settings'] as const;
const stateChangeMessages = ['commitBaseline'] as const;

const categorySets = {
  lifecycle: new Set<string>(lifecycleMessages),
  login: new Set<string>(loginMessages),
  panel: new Set<string>(panelMessages),
  editor: new Set<string>(editorMessages),
  stateChange: new Set<string>(stateChangeMessages),
} as const;

type MessageCategory = keyof typeof categorySets; // 'lifecycle' | 'login' | 'panel' | 'editor' | 'stateChange'

// Build a lookup table once (and detect accidental duplicates)
const messageToCategoryLokup = (() => {
  const map = new Map<string, MessageCategory>();
  for (const [category, set] of Object.entries(categorySets) as Array<[MessageCategory, Set<string>]>) {
    for (const msg of set) {
      map.set(msg, category);
    }
  }
  return map;
})();

function getMessageCategory(message: string): MessageCategory | 'unknown' {
  return messageToCategoryLokup.get(message) ?? 'unknown';
}

function handleLifecyleMessage(homeView: HomeView, message: { messageType: string; payload: any }) {
  switch (message.messageType) {
    case 'init':
      homeView.setInitiated(true);
      return;
  }
}
function handleLoginMessage(homeView: HomeView, message: { messageType: string; payload: any }) {
  switch (message.messageType) {
    case 'open-login':
      handleOpenLogin(homeView);
      return;
    case 'open-home':
      handleCloseLogin(homeView);
      return;
    case 'init-login':
      handleInitLogin(homeView);
      return;
  }
}
function handlePanelMessage(homeView: HomeView, message: { messageType: string; payload: any }) {
  switch (message.messageType) {
    case 'request-and-present-refactoring':
      handleAutoRefactor(message.payload);
      return;
    case 'open-docs-for-function':
      handleOpenDocs(homeView, message.payload);
      return;
  }
}
async function handleEditorMessage(homeView: HomeView, message: { messageType: string; payload: any }) {
  switch (message.messageType) {
    case 'goto-function-location':
      await handleGoToFunction(homeView, message.payload);
      return;
    case 'open-settings':
      handleOpenSettings();
      return;
  }
}
async function handleStateChangeMessage(homeView: HomeView, message: { messageType: string; payload: any }) {
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
export async function handleCWFMessage(homeView: HomeView, message: { messageType: string; payload: any }) {
  switch (getMessageCategory(message.messageType)) {
    case 'lifecycle':
      handleLifecyleMessage(homeView, message);
      return;
    case 'login':
      handleLoginMessage(homeView, message);
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
