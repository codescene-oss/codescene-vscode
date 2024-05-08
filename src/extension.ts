import * as vscode from 'vscode';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import { checkCodeHealthRules } from './check-rules';
import { onDidChangeConfiguration } from './configuration';
import CsDiagnostics from './cs-diagnostics';
import { CsExtensionState } from './cs-extension-state';
import { register as registerCsDoc } from './csdoc';
import { DeltaAnalyser, registerDeltaCommand } from './delta/analyser';
import { registerDeltaAnalysisDecorations } from './delta/presentation';
import { DeltaAnalysisView } from './delta/tree-view';
import { ensureLatestCompatibleCliExists } from './download';
import { reviewDocumentSelector } from './language-support';
import { outputChannel } from './log';
import { disableACE, enableACE } from './refactoring/addon';
import { CsRefactoringRequests } from './refactoring/cs-refactoring-requests';
import { CsReviewCodeLensProvider } from './review/codelens';
import { ReviewExplorerView } from './review/explorer-view';
import { registerReviewDecorations } from './review/presentation';
import Reviewer from './review/reviewer';
import { createRulesTemplate } from './rules-template';
import { StatsCollector } from './stats';
import Telemetry from './telemetry';
import { CsWorkspace } from './workspace';
import debounce = require('lodash.debounce');

interface CsContext {
  cliPath: string;
  csWorkspace: CsWorkspace;
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
      startExtension(context, cliPath);
    })
    .catch((error: Error) => {
      const { message } = error;
      CsExtensionState.setCliState(error);
      outputChannel.appendLine(message);
      void vscode.window.showErrorMessage(`Error initiating the CodeScene CLI: ${message}`);
    });

  setupStatsCollector();
}

function startExtension(context: vscode.ExtensionContext, cliPath: string) {
  const csContext: CsContext = {
    cliPath,
    csWorkspace: new CsWorkspace(context),
  };
  Reviewer.init(cliPath);
  DeltaAnalyser.init(cliPath);
  CsExtensionState.addListeners();

  Telemetry.init(context.extension, cliPath);
  // send telemetry on activation (gives us basic usage stats)
  Telemetry.instance.logUsage('onActivateExtension');

  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnostics.init(context);
  createAuthProvider(context, csContext);
  registerCommands(context, csContext);
  registerCsDoc(context);
  addReviewListeners(context);
  addTmpDiffUriScheme(context);

  context.subscriptions.push(new ReviewExplorerView());
  registerReviewDecorations(context);

  context.subscriptions.push(new DeltaAnalysisView());
  registerDeltaAnalysisDecorations(context);

  // Add Review CodeLens support
  const codeLensProvider = new CsReviewCodeLensProvider();
  context.subscriptions.push(codeLensProvider);
  context.subscriptions.push(vscode.languages.registerCodeLensProvider(reviewDocumentSelector(), codeLensProvider));

  // If configuration option is changed, en/disable ACE capabilities accordingly - debounce to handle rapid changes
  const debouncedEnableOrDisableACECapabilities = debounce(enableOrDisableACECapabilities, 500);
  context.subscriptions.push(
    onDidChangeConfiguration('enableAutoRefactor', (e) => {
      debouncedEnableOrDisableACECapabilities(context, csContext.cliPath);
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
  const { cliPath } = csContext;

  registerDeltaCommand(context, cliPath);

  const openCodeHealthDocsCmd = vscode.commands.registerCommand('codescene.openCodeHealthDocs', () => {
    void vscode.env.openExternal(vscode.Uri.parse('https://codescene.io/docs/guides/technical/code-health.html'));
  });
  context.subscriptions.push(openCodeHealthDocsCmd);

  const createRulesTemplateCmd = vscode.commands.registerCommand('codescene.createRulesTemplate', () => {
    createRulesTemplate(cliPath).catch((error: Error) => {
      void vscode.window.showErrorMessage(error.message);
    });
  });
  context.subscriptions.push(createRulesTemplateCmd);

  const createCheckRules = vscode.commands.registerCommand('codescene.checkRules', () => {
    void checkCodeHealthRules(cliPath);
  });
  context.subscriptions.push(createCheckRules);

  // This command tries to get a "codescene" session. The createIfNone option causes a dialog to pop up,
  // asking the user to log in. (Currently unused)
  const loginCommand = vscode.commands.registerCommand('codescene.signInWithCodeScene', () => {
    vscode.authentication
      .getSession(AUTH_TYPE, [], { createIfNone: true })
      .then(onGetSessionSuccess(context, csContext.cliPath), onGetSessionError());
  });
  context.subscriptions.push(loginCommand);
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
        // Immediately clear request list on code changes
        CsRefactoringRequests.delete(e.document);
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
function enableRemoteFeatures(context: vscode.ExtensionContext, cliPath: string) {
  enableOrDisableACECapabilities(context, cliPath);
}

function disableRemoteFeatures() {
  disableACE();
}

function enableOrDisableACECapabilities(context: vscode.ExtensionContext, cliPath: string) {
  CsExtensionState.setACEState('Loading ACE capabilities...');
  enableACE(context, cliPath).then(
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
  vscode.authentication
    .getSession(AUTH_TYPE, [])
    .then(onGetSessionSuccess(context, csContext.cliPath), onGetSessionError());

  // Handle login/logout session changes
  authProvider.onDidChangeSessions((e) => {
    if (e.removed && e.removed.length > 0) {
      // Without the following getSession call, the login option in the accounts picker will not reappear!
      // This is probably refreshing the account picker under the hood
      void vscode.authentication.getSession(AUTH_TYPE, []);
      onGetSessionSuccess(context, csContext.cliPath)(undefined); // removed a session
    }
    if (e.added && e.added.length > 0) {
      // We only have one session in this extension currently, so grabbing the first one is ok.
      onGetSessionSuccess(context, csContext.cliPath)(e.added[0]);
    }
  });
  context.subscriptions.push(authProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}

function onGetSessionSuccess(context: vscode.ExtensionContext, cliPath: string) {
  return (session: vscode.AuthenticationSession | undefined) => {
    CsExtensionState.setSession(session);
    if (session) {
      enableRemoteFeatures(context, cliPath);
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
