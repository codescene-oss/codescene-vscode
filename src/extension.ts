import * as vscode from 'vscode';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import { getConfiguration, onDidChangeConfiguration } from './configuration';
import CsDiagnosticsCollection, { CsDiagnostics } from './cs-diagnostics';
import { CsExtensionState } from './cs-extension-state';
import { CsRestApi } from './cs-rest-api';
import { categoryToDocsCode, registerCsDocProvider } from './csdoc';
import { ensureLatestCompatibleCliExists } from './download';
import { reviewDocumentSelector, toRefactoringDocumentSelector } from './language-support';
import { outputChannel } from './log';
import { CsRefactorCodeAction } from './refactoring/codeaction';
import { CsRefactorCodeLensProvider } from './refactoring/codelens';
import { CsRefactoringCommands } from './refactoring/commands';
import { CsRefactoringRequests } from './refactoring/cs-refactoring-requests';
import { RefactoringsView } from './refactoring/refactorings-view';
import { createCodeSmellsFilter } from './refactoring/utils';
import { CsReviewCodeLensProvider } from './review/codelens';
import Reviewer from './review/reviewer';
import { createRulesTemplate } from './rules-template';
import { StatsCollector } from './stats';
import Telemetry from './telemetry';
import { registerStatusViewProvider } from './webviews/status-view-provider';
import { CsWorkspace } from './workspace';
import debounce = require('lodash.debounce');

interface CsContext {
  cliPath: string;
  csWorkspace: CsWorkspace;
  csExtensionState: CsExtensionState;
  csDiagnostics: CsDiagnostics;
  csRestApi: CsRestApi;
}

/**
 * Extension entry point
 * @param context
 */
export async function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('Activating extension...');

  const csExtensionState = new CsExtensionState(registerStatusViewProvider(context));

  ensureLatestCompatibleCliExists(context.extensionPath).then((cliStatus) => {
    csExtensionState.setCliStatus(cliStatus);
    if (!cliStatus.cliPath) {
      vscode.window.showErrorMessage(
        `Error initiating the CodeScene CLI: ${cliStatus.error || 'Unknown error starting extension'}`
      );
      return;
    }
    startExtension(context, cliStatus.cliPath, csExtensionState);
  });

  setupStatsCollector();
}

function startExtension(context: vscode.ExtensionContext, cliPath: string, csExtensionState: CsExtensionState) {
  const csDiagnostics = new CsDiagnostics();
  const csContext: CsContext = {
    cliPath,
    csDiagnostics,
    csWorkspace: new CsWorkspace(context),
    csExtensionState,
    csRestApi: new CsRestApi(context.extension),
  };
  Reviewer.init(cliPath);
  setupTelemetry(cliPath);

  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnosticsCollection.init(context);
  createAuthProvider(context, csContext);
  registerCommands(context, csContext);
  registerCsDocProvider(context);
  addReviewListeners(context, csDiagnostics);
  addTmpDiffUriScheme(context);

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
  const { cliPath, csRestApi, csExtensionState } = csContext;

  const openCodeHealthDocsCmd = vscode.commands.registerCommand('codescene.openCodeHealthDocs', () => {
    vscode.env.openExternal(vscode.Uri.parse('https://codescene.io/docs/guides/technical/code-health.html'));
  });
  context.subscriptions.push(openCodeHealthDocsCmd);

  const createRulesTemplateCmd = vscode.commands.registerCommand('codescene.createRulesTemplate', () => {
    createRulesTemplate(cliPath);
  });
  context.subscriptions.push(createRulesTemplateCmd);

  const openDocsForDiagnostic = vscode.commands.registerCommand(
    'codescene.openDocsForDiagnostic',
    async (diag: vscode.Diagnostic) => {
      if (typeof diag.code === 'object') {
        const docsCode = categoryToDocsCode(diag.code.value.toString());
        vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.parse(`csdoc:${docsCode}.md`));
      } else {
        const codeHealthDocs = 'Open general code health documentation';

        let options = [];
        options.push(codeHealthDocs);

        const action = await vscode.window.showQuickPick(options);

        if (action === codeHealthDocs) {
          vscode.commands.executeCommand('codescene.openCodeHealthDocs');
        }
      }
    }
  );
  context.subscriptions.push(openDocsForDiagnostic);

  // This command tries to get a "codescene" session. The createIfNone option causes a dialog to pop up,
  // asking the user to log in. (Currently unused)
  const loginCommand = vscode.commands.registerCommand('codescene.signInWithCodeScene', () => {
    vscode.authentication.getSession(AUTH_TYPE, [], { createIfNone: true });
  });
  context.subscriptions.push(loginCommand);

  // This command is registered here, but acting as a noop until it gets an appropriate preflight response
  const refactoringCommand = new CsRefactoringCommands(context, csRestApi, cliPath);
  csExtensionState.setRefactoringCommand(refactoringCommand);
}

function setupTelemetry(cliPath: string) {
  Telemetry.init(cliPath);

  // send telemetry on activation (gives us basic usage stats)
  Telemetry.instance.logUsage('onActivateExtension');
}

/**
 * Adds listeners for all events that should trigger a review.
 *
 */
function addReviewListeners(context: vscode.ExtensionContext, csDiagnostics: CsDiagnostics) {
  // This provides the initial diagnostics when a file is opened.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
      csDiagnostics.review(document);
    })
  );

  // For live updates, we debounce the runs to avoid consuming too many resources.
  const debouncedRun = debounce(csDiagnostics.review.bind(csDiagnostics), 2000);
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
    csDiagnostics.review(document);
  });

  // Use a file system watcher to rerun diagnostics when .codescene/code-health-rules.json changes.
  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/.codescene/code-health-rules.json');
  fileSystemWatcher.onDidChange((uri: vscode.Uri) => {
    outputChannel.appendLine(`code-health-rules.json changed, updating diagnostics`);
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      csDiagnostics.review(document, { skipCache: true });
    });
  });
  context.subscriptions.push(fileSystemWatcher);
}

/**
 * Activate functionality that requires signing in to a CodeScene server.
 */
async function enableRemoteFeatures(context: vscode.ExtensionContext, csContext: CsContext) {
  await enableOrDisableACECapabilities(context, csContext);
}

/**
 * If config is enabled, try to enable ACE capabilities by getting a preflight response.
 * If disabled manually by the config option, the capabilities are disabled with an appropriate message.
 *
 * @param context
 * @param csContext
 */
async function enableOrDisableACECapabilities(context: vscode.ExtensionContext, csContext: CsContext) {
  const enableACE = getConfiguration('enableAutoRefactor');
  if (!enableACE) {
    const msg = 'Auto-refactor disabled in configuration.';
    csContext.csExtensionState.disableACE(msg);
    outputChannel.appendLine(msg);
    return;
  }

  // Make sure to clear the capabilities first, disposing components so we don't accidentally get multiple codelenses etc.
  csContext.csExtensionState.disableACE('Loading ACE capabilities...');

  const { csRestApi, csDiagnostics, csExtensionState } = csContext;
  const preflightResponse = await csRestApi.fetchRefactorPreflight().catch((error: Error) => {
    const { message } = error;
    outputChannel.appendLine(`Unable to fetch refactoring capabilities. ${message}`);
    vscode.window.showErrorMessage(`Unable to fetch refactoring capabilities. ${message}`);
    return error;
  });
  
  if (typeof preflightResponse === 'string' || preflightResponse instanceof Error) {
    csContext.csExtensionState.disableACE(preflightResponse);
  } else {
    const refactoringSelector = toRefactoringDocumentSelector(preflightResponse.supported);
    const codeSmellFilter = createCodeSmellsFilter(preflightResponse);

    // Collect all disposables used by the refactoring features
    const disposables: vscode.Disposable[] = [];
    const codeLensProvider = new CsRefactorCodeLensProvider(codeSmellFilter);
    disposables.push(codeLensProvider);
    disposables.push(vscode.languages.registerCodeLensProvider(refactoringSelector, codeLensProvider));

    disposables.push(
      vscode.languages.registerCodeActionsProvider(refactoringSelector, new CsRefactorCodeAction(codeSmellFilter), {
        providedCodeActionKinds: CsRefactorCodeAction.providedCodeActionKinds,
      })
    );

    disposables.push(new RefactoringsView());

    /* Add disposables to both subscription context and the extension state list
     * of disposables. This is to ensure they're disposed either when the extension
     * is deactivated or if the online features are disabled */
    context.subscriptions.push(...disposables);

    csExtensionState.enableACE(preflightResponse, disposables);

    // Force update diagnosticCollection to request initial refactorings
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      csDiagnostics.review(document, { skipCache: true });
    });

    outputChannel.appendLine('Auto-refactor enabled!');
  }
}

function createAuthProvider(context: vscode.ExtensionContext, csContext: CsContext) {
  const { csExtensionState } = csContext;
  const authProvider = new CsAuthenticationProvider(context);

  // Provides the initial session - will enable remote features and update workspace state
  vscode.authentication.getSession(AUTH_TYPE, []).then((session) => {
    if (session) {
      enableRemoteFeatures(context, csContext);
      csExtensionState.setSession(session);
    }
  });

  // Handle login/logout session changes
  authProvider.onDidChangeSessions((e) => {
    if (e.added && e.added.length > 0) {
      enableRemoteFeatures(context, csContext);
      // We only have one session in this extension currently, so grabbing the first one is ok.
      csExtensionState.setSession(e.added[0]);
    } else {
      // Without the following getSession call, the login option in the accounts picker will not reappear!
      // This is probably refreshing the account picker under the hood
      vscode.authentication.getSession(AUTH_TYPE, []);
      csExtensionState.setSession(undefined);
    }
  });
  context.subscriptions.push(authProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
