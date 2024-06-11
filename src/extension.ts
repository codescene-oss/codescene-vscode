import vscode from 'vscode';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import { checkCodeHealthRules } from './check-rules';
import { activate as activateCodeHealthGate } from './code-health-gate/addon';
import { DeltaAnalyser, registerDeltaCommand } from './code-health-gate/analyser';
import { onDidChangeConfiguration } from './configuration';
import { CsExtensionState } from './cs-extension-state';
import CsDiagnostics from './diagnostics/cs-diagnostics';
import { register as registerCsDoc } from './documentation/csdoc-provider';
import { ensureLatestCompatibleCliExists } from './download';
import { reviewDocumentSelector } from './language-support';
import { outputChannel } from './log';
import { AceAPI, activate as activateAce } from './refactoring/addon';
import { CsReviewCodeLensProvider } from './review/codelens';
import Reviewer from './review/reviewer';
import { createRulesTemplate } from './rules-template';
import { StatsCollector } from './stats';
import Telemetry from './telemetry';
import { CsWorkspace } from './workspace';
import debounce = require('lodash.debounce');
import { registerCommandWithTelemetry } from './utils';

interface CsContext {
  csWorkspace: CsWorkspace;
  aceApi: AceAPI;
}

/**
 * Extension entry point
 * @param context
 */
export async function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('Activating extension...');

  CsExtensionState.init(context);

  ensureLatestCompatibleCliExists(context.extensionPath)
    .then((cliPath) => {
      CsExtensionState.setCliState(cliPath);
      startExtension(context);
    })
    .catch((error: Error) => {
      const { message } = error;
      CsExtensionState.setCliState(error);
      outputChannel.appendLine(message);
      void vscode.window.showErrorMessage(`Error initiating the CodeScene CLI: ${message}`);
    });

  setupStatsCollector();
}

function startExtension(context: vscode.ExtensionContext) {
  const csContext: CsContext = {
    csWorkspace: new CsWorkspace(context),
    aceApi: activateAce(),
  };
  Reviewer.init();
  DeltaAnalyser.init();
  CsExtensionState.addListeners();

  Telemetry.init(context.extension);
  // send telemetry on activation (gives us basic usage stats)
  Telemetry.instance.logUsage('onActivateExtension');

  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnostics.init(context);
  createAuthProvider(context, csContext);
  registerCommands(context, csContext);
  registerCsDoc(context);
  addReviewListeners(context);
  addTmpDiffUriScheme(context);

  activateCodeHealthGate(context, csContext.aceApi);

  // Add Review CodeLens support
  const codeLensProvider = new CsReviewCodeLensProvider();
  context.subscriptions.push(codeLensProvider);
  context.subscriptions.push(vscode.languages.registerCodeLensProvider(reviewDocumentSelector(), codeLensProvider));

  // If configuration option is changed, en/disable ACE capabilities accordingly - debounce to handle rapid changes
  const debouncedEnableOrDisableACECapabilities = debounce(enableOrDisableACECapabilities, 500);
  context.subscriptions.push(
    onDidChangeConfiguration('enableAutoRefactor', (e) => {
      debouncedEnableOrDisableACECapabilities(context, csContext);
    })
  );

  outputChannel.appendLine('Extension is now active!');
}

// Use this scheme for the virtual documents when diffing the refactoring
function addTmpDiffUriScheme(context: vscode.ExtensionContext) {
  const uriQueryContentProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return uri.query;
    }
  })();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('tmp-diff', uriQueryContentProvider));
}

/**
 * Setup a scheduled event for sending usage statistics
 */
function setupStatsCollector() {
  setInterval(() => {
    const stats = StatsCollector.instance.stats;

    // Send execution stats by language
    if (stats.analysis.length > 0) {
      for (const byLanguage of stats.analysis) {
        Telemetry.instance.logUsage('stats', { stats: { analysis: byLanguage } });
      }
    }

    StatsCollector.instance.clear();
  }, 1800 * 1000);
}

function registerCommands(context: vscode.ExtensionContext, csContext: CsContext) {
  registerDeltaCommand(context);

  const openCodeHealthDocsCmd = registerCommandWithTelemetry({
    commandId: 'codescene.openCodeHealthDocs',
    handler: () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://codescene.io/docs/guides/technical/code-health.html'));
    },
  });
  context.subscriptions.push(openCodeHealthDocsCmd);

  const createRulesTemplateCmd = registerCommandWithTelemetry({
    commandId: 'codescene.createRulesTemplate',
    handler: () => {
      createRulesTemplate().catch((error: Error) => {
        void vscode.window.showErrorMessage(error.message);
      });
    },
  });
  context.subscriptions.push(createRulesTemplateCmd);

  const createCheckRules = registerCommandWithTelemetry({
    commandId: 'codescene.checkRules',
    handler: () => {
      void checkCodeHealthRules();
    },
  });
  context.subscriptions.push(createCheckRules);
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
  const debouncedRun = debounce(CsDiagnostics.review, 2000);
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
      // avoid debouncing 'output' documents etc.
      if (e.document.uri.scheme === 'file') {
        debouncedRun(e.document);
      }
    })
  );

  // This provides the initial diagnostics when the extension is first activated.
  vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
    CsDiagnostics.review(document);
  });

  // Use a file system watcher to rerun diagnostics when .codescene/code-health-rules.json changes.
  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/.codescene/code-health-rules.json');
  fileSystemWatcher.onDidChange((uri: vscode.Uri) => {
    outputChannel.appendLine(`code-health-rules.json changed, updating diagnostics`);
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
      outputChannel.appendLine('Auto-refactor enabled!');
    },
    (error: Error | string) => {
      if (error instanceof Error) {
        const message = `Unable to enable refactoring capabilities. ${error.message}`;
        outputChannel.appendLine(message);
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
  context.subscriptions.push(authProvider);
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
