import vscode from 'vscode';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import { activate as activateCHMonitor } from './code-health-monitor/addon';
import { refreshCodeHealthDetailsView } from './code-health-monitor/details/view';
import { register as registerCHRulesCommands } from './code-health-rules';
import { CodeSceneTabPanel } from './codescene-tab/webview-panel';
import { onDidChangeConfiguration, toggleReviewCodeLenses } from './configuration';
import { CsExtensionState } from './cs-extension-state';
import { DevtoolsAPI } from './devtools-api';
import CsDiagnostics from './diagnostics/cs-diagnostics';
import { register as registerDocumentationCommands } from './documentation/commands';
import { register as registerCsDocProvider } from './documentation/csdoc-provider';
import { ensureCompatibleBinary } from './download';
import { reviewDocumentSelector } from './language-support';
import { logOutputChannel, registerShowLogCommand } from './log';
import { initAce } from './refactoring';
import { register as registerCodeActionProvider } from './review/codeaction';
import { CsReviewCodeLensProvider } from './review/codelens';
import Reviewer from './review/reviewer';
import { CsServerVersion } from './server-version';
import { setupStatsCollector } from './stats';
import Telemetry from './telemetry';
import { assertError, reportError } from './utils';
import { CsWorkspace } from './workspace';
import debounce = require('lodash.debounce');
import { registerCopyDeviceIdCommand } from './device-id';

interface CsContext {
  csWorkspace: CsWorkspace;
}

/**
 * Extension entry point
 * @param context
 */
export async function activate(context: vscode.ExtensionContext) {
  logOutputChannel.info('⚙️ Activating extension...');
  CsExtensionState.init(context);

  ensureCompatibleBinary(context.extensionPath).then(
    async (binaryPath) => {
      DevtoolsAPI.init(binaryPath, context);
      await Telemetry.init(context);

      try {
        Reviewer.init(context);
        CsExtensionState.setAnalysisState({ state: 'enabled' });
        await startExtension(context);
        finalizeActivation(context);
      } catch (e) {
        CsExtensionState.setAnalysisState({ state: 'error', error: assertError(e) });
        reportError({ context: 'Unable to start extension', e });
        void vscode.commands.executeCommand('codescene.controlCenterView.focus');
      }
    },
    (e) => {
      const error = assertError(e);
      CsExtensionState.setAnalysisState({ state: 'error', error });
      reportError({ context: 'Unable to start extension', e });
      void vscode.commands.executeCommand('codescene.controlCenterView.focus');
      Telemetry.logUsage('on_activate_extension_error', { errorMessage: error.message });
    }
  );
}

async function startExtension(context: vscode.ExtensionContext) {
  const csContext: CsContext = {
    csWorkspace: new CsWorkspace(context),
  };
  CsServerVersion.init();

  CsExtensionState.addListeners(context);
  initAce(context);

  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnostics.init(context);
  createAuthProvider(context, csContext);
  registerCommands(context, csContext);
  registerCsDocProvider(context);
  addReviewListeners(context);
  setupStatsCollector(context);

  activateCHMonitor(context);

  // Add Review CodeLens support
  const codeLensProvider = new CsReviewCodeLensProvider();
  context.subscriptions.push(codeLensProvider);
  context.subscriptions.push(vscode.languages.registerCodeLensProvider(reviewDocumentSelector(), codeLensProvider));

  registerCodeActionProvider(context);

  // If configuration option is changed, en/disable ACE capabilities accordingly - debounce to handle rapid changes
  const debouncedSetEnabledAce = debounce((enabled: boolean) => {
    void vscode.commands.executeCommand('codescene.ace.setEnabled', enabled);
  }, 500);
  context.subscriptions.push(
    onDidChangeConfiguration('enableAutoRefactor', (e) => {
      debouncedSetEnabledAce(e.value);
    })
  );
}

/**
 * This function finalizes the activation of the extension by setting a context variable.
 * The context variable is used in package.json to conditionally enable/disable views that could
 * point to commands that haven't been fully initialized.
 */
function finalizeActivation(context: vscode.ExtensionContext) {
  // send telemetry on activation (gives us basic usage stats)
  Telemetry.logUsage('on_activate_extension');
  registerCopyDeviceIdCommand(context);
  void vscode.commands.executeCommand('setContext', 'codescene.asyncActivationFinished', true);
}

function registerCommands(context: vscode.ExtensionContext, csContext: CsContext) {
  registerShowLogCommand(context);
  registerDocumentationCommands(context);

  const toggleReviewCodeLensesCmd = vscode.commands.registerCommand('codescene.toggleReviewCodeLenses', () => {
    toggleReviewCodeLenses();
  });
  context.subscriptions.push(toggleReviewCodeLensesCmd);

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

  const docSelector = reviewDocumentSelector();
  let reviewTimer: NodeJS.Timeout | undefined;

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
      // avoid reviewing non-matching documents
      if (vscode.languages.match(docSelector, e.document) === 0) {
        return;
      }
      clearTimeout(reviewTimer);
      // Run review after 1 second of no edits
      reviewTimer = setTimeout(() => {
        CsDiagnostics.review(e.document);
      }, 1000);
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

async function handleSignOut(authProvider: CsAuthenticationProvider) {
  if (CsExtensionState.session?.id) {
    await authProvider.removeSession(CsExtensionState.session.id);
    void vscode.window.showInformationMessage('Signed out from CodeScene.');
  } else {
    void vscode.window.showInformationMessage('Not signed in to CodeScene.');
  }
}

function createAuthProvider(context: vscode.ExtensionContext, csContext: CsContext) {
  const authProvider = new CsAuthenticationProvider(context);

  // Register manual sign in command
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.signIn', async () => {
      const existingSession = await vscode.authentication.getSession(AUTH_TYPE, [], { silent: true });
      vscode.authentication
        .getSession(AUTH_TYPE, [], { createIfNone: true })
        .then(onGetSessionSuccess(context, csContext, !!existingSession), onGetSessionError());
    })
  );

  // Register manual sign out command
  context.subscriptions.push(vscode.commands.registerCommand('codescene.signOut', () => handleSignOut(authProvider)));

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
    refreshCodeHealthDetailsView();
    CodeSceneTabPanel.refreshIfExists();
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

  const authTokenChangedDisposable = onDidChangeConfiguration('authToken', () => {
    refreshCodeHealthDetailsView();
    CodeSceneTabPanel.refreshIfExists();
    // TODO: refresh CWF view(s)
  });

  context.subscriptions.push(authProvider, serverUrlChangedDisposable, authTokenChangedDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

function onGetSessionSuccess(context: vscode.ExtensionContext, csContext: CsContext, showAlreadySignedIn = false) {
  return (session: vscode.AuthenticationSession | undefined) => {
    CsExtensionState.setSession(session);
    if (session) {
      if (showAlreadySignedIn) {
        void vscode.window.showInformationMessage('Already signed in to CodeScene.');
      }
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
