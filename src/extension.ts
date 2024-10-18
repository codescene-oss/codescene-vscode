import vscode from 'vscode';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import { activate as activateCHMonitor } from './code-health-monitor/addon';
import { DeltaAnalyser } from './code-health-monitor/analyser';
import { register as registerCHRulesCommands } from './code-health-rules';
import { onDidChangeConfiguration, toggleReviewCodeLenses } from './configuration';
import { CsExtensionState } from './cs-extension-state';
import CsDiagnostics from './diagnostics/cs-diagnostics';
import { register as registerCsDoc } from './documentation/csdoc-provider';
import { ensureCompatibleBinary } from './download';
import { reviewDocumentSelector } from './language-support';
import { logOutputChannel } from './log';
import { AceAPI, activate as activateAce } from './refactoring/addon';
import { register as registerCodeActionProvider } from './review/codeaction';
import { CsReviewCodeLensProvider } from './review/codelens';
import Reviewer from './review/reviewer';
import { CsServerVersion } from './server-version';
import { setupStatsCollector } from './stats';
import Telemetry from './telemetry';
import { registerCommandWithTelemetry } from './utils';
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

  ensureCompatibleBinary(context.extensionPath)
    .then((cliPath) => {
      CsExtensionState.setCliState(cliPath);
      startExtension(context);
    })
    .catch((error: Error) => {
      const { message } = error;
      CsExtensionState.setCliState(error);
      logOutputChannel.error(message);
      void vscode.commands.executeCommand('codescene.statusView.focus');
    });
}

function startExtension(context: vscode.ExtensionContext) {
  const csContext: CsContext = {
    csWorkspace: new CsWorkspace(context),
    aceApi: activateAce(),
  };
  Reviewer.init();
  DeltaAnalyser.init();
  CsServerVersion.init();
  CsExtensionState.addListeners(context);

  // send telemetry on activation (gives us basic usage stats)
  Telemetry.instance.logUsage('onActivateExtension');

  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnostics.init(context);
  createAuthProvider(context, csContext);
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
    onDidChangeConfiguration('enableAutoRefactor', (e) => {
      debouncedEnableOrDisableACECapabilities(context, csContext);
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
function enableRemoteFeatures(context: vscode.ExtensionContext, csContext: CsContext) {
  enableOrDisableACECapabilities(context, csContext);
}

function disableRemoteFeatures(aceApi: AceAPI) {
  aceApi.disableACE();
}

function enableOrDisableACECapabilities(context: vscode.ExtensionContext, csContext: CsContext) {
  const { aceApi } = csContext;
  CsExtensionState.setACEState('Loading ACE capabilities...');
  aceApi.enableACE(context).then(
    (result) => {
      CsExtensionState.setACEState(result);
      logOutputChannel.info('Auto-refactor enabled!');
    },
    (error: Error | string) => {
      if (error instanceof Error) {
        const message = `Unable to enable refactoring capabilities. ${error.message}`;
        logOutputChannel.error(message);
        void vscode.window.showErrorMessage(message);
      }
      CsExtensionState.setACEState(error);
    }
  );
}

function createAuthProvider(context: vscode.ExtensionContext, csContext: CsContext) {
  const authProvider = new CsAuthenticationProvider(context);

  // If there's already a session we enable the remote features, otherwise a badge will appear in the
  // accounts menu - see AuthenticationGetSessionOptions.createIfNone?: boolean
  vscode.authentication.getSession(AUTH_TYPE, []).then(onGetSessionSuccess(context, csContext), onGetSessionError());

  // Handle login/logout session changes
  authProvider.onDidChangeSessions((e) => {
    if (e.removed && e.removed.length > 0) {
      // Without the following getSession call, the login option in the accounts picker will not reappear!
      // This is probably refreshing the account picker under the hood
      void vscode.authentication.getSession(AUTH_TYPE, []);
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
      disableRemoteFeatures(csContext.aceApi);
    }
  };
}

function onGetSessionError() {
  return (error: any) => {
    CsExtensionState.setSession();
    void vscode.window.showErrorMessage(`Error signing in with CodeScene: ${error}`);
  };
}
