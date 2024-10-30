import vscode from 'vscode';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import { activate as activateCHMonitor } from './code-health-monitor/addon';
import { DeltaAnalyser } from './code-health-monitor/analyser';
import { register as registerCHRulesCommands } from './code-health-rules';
import { getConfiguration, onDidChangeConfiguration, toggleReviewCodeLenses } from './configuration';
import { CsExtensionState } from './cs-extension-state';
import CsDiagnostics from './diagnostics/cs-diagnostics';
import { register as registerCsDoc } from './documentation/csdoc-provider';
import { ensureCompatibleBinary } from './download';
import { reviewDocumentSelector } from './language-support';
import { logOutputChannel, registerShowLogCommand } from './log';
import { AceAPI, activate as activateAce } from './refactoring/addon';
import { register as registerCodeActionProvider } from './review/codeaction';
import { CsReviewCodeLensProvider } from './review/codelens';
import Reviewer from './review/reviewer';
import { CsServerVersion } from './server-version';
import { setupStatsCollector } from './stats';
import Telemetry from './telemetry';
import { isError, registerCommandWithTelemetry } from './utils';
import { CsWorkspace } from './workspace';
import debounce = require('lodash.debounce');

interface CsContext {
  csWorkspace: CsWorkspace;
  aceApi: AceAPI;
}

/**
 * Extension entry point
 * @param context
 */
export async function activate(context: vscode.ExtensionContext) {
  logOutputChannel.info('⚙️ Activating extension...');

  CsExtensionState.init(context);
  Telemetry.init(context.extension);
  registerShowLogCommand(context);

  try {
    const binaryPath = await ensureCompatibleBinary(context.extensionPath);
    CsExtensionState.setAnalysisState({ binaryPath, state: 'enabled' });
    await startExtension(context);
  } catch (unknownErr) {
    const error = assertError(unknownErr);
    if (!error) return;

    CsExtensionState.setAnalysisState({ state: 'error', error });
    reportError('Unable to start extension', error);
  }
}

async function startExtension(context: vscode.ExtensionContext) {
  const csContext: CsContext = {
    csWorkspace: new CsWorkspace(context),
    aceApi: activateAce(),
  };
  Reviewer.init();
  DeltaAnalyser.init();
  CsServerVersion.init();
  CsExtensionState.addListeners(context, csContext.aceApi);

  // send telemetry on activation (gives us basic usage stats)
  Telemetry.instance.logUsage('onActivateExtension');

  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnostics.init(context);
  createAuthProvider(context, csContext);
  await enableOrDisableACECapabilities(context, csContext);
  registerCommands(context, csContext);
  registerCsDoc(context);
  addReviewListeners(context);
  setupStatsCollector(context);

  activateCHMonitor(context, csContext.aceApi);

  // Add Review CodeLens support
  const codeLensProvider = new CsReviewCodeLensProvider();
  context.subscriptions.push(codeLensProvider);
  context.subscriptions.push(vscode.languages.registerCodeLensProvider(reviewDocumentSelector(), codeLensProvider));

  registerCodeActionProvider(context, csContext.aceApi);

  // If configuration option is changed, en/disable ACE capabilities accordingly - debounce to handle rapid changes
  const debouncedEnableOrDisableACECapabilities = debounce(enableOrDisableACECapabilities, 500);
  context.subscriptions.push(
    onDidChangeConfiguration('enableAutoRefactor', async (e) => {
      await debouncedEnableOrDisableACECapabilities(context, csContext);
    })
  );

  context.subscriptions.push(
    onDidChangeConfiguration('devtoolsPortalUrl', async (e) => {
      await debouncedEnableOrDisableACECapabilities(context, csContext);
    })
  );

  finalizeActivation();
}

/**
 * This function finalizes the activation of the extension by setting a context variable.
 * The context variable is used in package.json to conditionally enable/disable views that could
 * point to commands that haven't been fully initialized.
 */
function finalizeActivation() {
  void vscode.commands.executeCommand('setContext', 'codescene.asyncActivationFinished', true);
}

function registerCommands(context: vscode.ExtensionContext, csContext: CsContext) {
  const openCodeHealthDocsCmd = registerCommandWithTelemetry({
    commandId: 'codescene.openCodeHealthDocs',
    handler: () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://codescene.io/docs/guides/technical/code-health.html'));
    },
  });

  const toggleReviewCodeLensesCmd = vscode.commands.registerCommand('codescene.toggleReviewCodeLenses', () => {
    toggleReviewCodeLenses();
  });
  context.subscriptions.push(openCodeHealthDocsCmd, toggleReviewCodeLensesCmd);

  registerCHRulesCommands(context);
}

/**
 * Adds listeners for all events that should trigger a review.
 *
 */
function addReviewListeners(context: vscode.ExtensionContext) {
  // This provides the initial diagnostics when a file is opened.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
      CsDiagnostics.review(document);
    })
  );

  // Close document listener for cancelling reviews and refactoring requests
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
      Reviewer.instance.abort(document);
    })
  );

  // For live updates, we debounce the runs to avoid consuming too many resources.
  const debouncedRun = debounce(CsDiagnostics.review, 1200);
  const docSelector = reviewDocumentSelector();
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
      // avoid debouncing non-matching documents
      if (vscode.languages.match(docSelector, e.document) === 0) return;
      debouncedRun(e.document);
    })
  );

  // This provides the initial diagnostics when the extension is first activated.
  vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
    CsDiagnostics.review(document);
  });

  // Use a file system watcher to rerun diagnostics when .codescene/code-health-rules.json changes.
  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/.codescene/code-health-rules.json');
  fileSystemWatcher.onDidChange((uri: vscode.Uri) => {
    logOutputChannel.info(`code-health-rules.json changed, updating diagnostics`);
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      CsDiagnostics.review(document, { skipCache: true });
    });
  });
  context.subscriptions.push(fileSystemWatcher);
}

/**
 * Activate functionality that requires signing in to a CodeScene server.
 */
function enableRemoteFeatures(context: vscode.ExtensionContext, csContext: CsContext) {}

function disableRemoteFeatures() {}

async function enableOrDisableACECapabilities(context: vscode.ExtensionContext, csContext: CsContext) {
  const { aceApi } = csContext;

  const enableACE = getConfiguration('enableAutoRefactor');
  if (!enableACE) {
    CsExtensionState.setACEState({ state: 'disabled' });
    return;
  }

  CsExtensionState.setACEState({ state: 'loading' });

  try {
    const preFlight = await aceApi.enableACE(context);
    CsExtensionState.setACEState({ preFlight, state: 'enabled' });
    logOutputChannel.info('Auto-refactor enabled!');
  } catch (unknownErr) {
    const error = assertError(unknownErr);
    if (!error) return;

    CsExtensionState.setACEState({ state: 'error', error });
    reportError('Unable to enable refactoring capabilities', error);
  }
}

function assertError(val: unknown): Error | undefined {
  if (!isError(val)) {
    logOutputChannel.error(`Unknown error: ${val}`);
    return;
  }
  return val;
}

function reportError(pre: string, error: Error) {
  const message = `${pre}. ${error.message}`;
  delete error.stack;
  logOutputChannel.error(`${message}: ${JSON.stringify(error)}`);
  void vscode.window.showErrorMessage(message);
  void vscode.commands.executeCommand('codescene.controlCenterView.focus');
}

function createAuthProvider(context: vscode.ExtensionContext, csContext: CsContext) {
  const authProvider = new CsAuthenticationProvider(context);

  // Register manual sign in command
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.signIn', async () => {
      vscode.authentication
        .getSession(AUTH_TYPE, [], { createIfNone: true })
        .then(onGetSessionSuccess(context, csContext), onGetSessionError());
    })
  );

  // If there's already a session we enable the remote features, otherwise silently add an option to
  // sign in in the accounts menu - see AuthenticationGetSessionOptions
  vscode.authentication
    .getSession(AUTH_TYPE, [], { silent: true })
    .then(onGetSessionSuccess(context, csContext), onGetSessionError());

  // Handle login/logout session changes
  authProvider.onDidChangeSessions((e) => {
    if (e.removed && e.removed.length > 0) {
      // Without the following getSession call, the login option in the accounts picker will not reappear!
      // This is probably refreshing the account picker under the hood
      void vscode.authentication.getSession(AUTH_TYPE, [], { silent: true });
      onGetSessionSuccess(context, csContext)(undefined); // removed a session
    }
    if (e.added && e.added.length > 0) {
      // We only have one session in this extension currently, so grabbing the first one is ok.
      onGetSessionSuccess(context, csContext)(e.added[0]);
    }
  });

  const serverUrlChangedDisposable = onDidChangeConfiguration('serverUrl', async (e) => {
    const changed = await CsServerVersion.reloadVersion();
    if (changed.serverChanged) {
      if (CsExtensionState.session?.id) {
        logOutputChannel.info('Server changed while signed in, removing obsolete auth session.');
        void authProvider.removeSession(CsExtensionState.session.id);
      }
    }
  });

  context.subscriptions.push(authProvider, serverUrlChangedDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

function onGetSessionSuccess(context: vscode.ExtensionContext, csContext: CsContext) {
  return (session: vscode.AuthenticationSession | undefined) => {
    CsExtensionState.setSession(session);
    if (session) {
      enableRemoteFeatures(context, csContext);
    } else {
      disableRemoteFeatures();
    }
  };
}

function onGetSessionError() {
  return (error: any) => {
    CsExtensionState.setSession();
    void vscode.window.showErrorMessage(`Error signing in with CodeScene: ${error}`);
  };
}
