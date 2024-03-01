import * as vscode from 'vscode';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import { getConfiguration, onDidChangeConfiguration } from './configuration';
import CsDiagnosticsCollection, { CsDiagnostics } from './cs-diagnostics';
import { CsRestApi } from './cs-rest-api';
import { CsStatusBar } from './cs-statusbar';
import { categoryToDocsCode, registerCsDocProvider } from './csdoc';
import { ensureLatestCompatibleCliExists } from './download';
import { toRefactoringDocumentSelector, reviewDocumentSelector } from './language-support';
import { outputChannel } from './log';
import { CsRefactorCodeAction } from './refactoring/codeaction';
import { CsRefactorCodeLensProvider } from './refactoring/codelens';
import { CsRefactoringCommand } from './refactoring/command';
import { CsRefactoringRequests } from './refactoring/cs-refactoring-requests';
import { RefactoringsView } from './refactoring/refactorings-view';
import { CsReviewCodeLensProvider } from './review/codelens';
import Reviewer from './review/reviewer';
import { createRulesTemplate } from './rules-template';
import { StatsCollector } from './stats';
import Telemetry from './telemetry';
import { registerStatusViewProvider } from './webviews/status-view-provider';
import { CsWorkspace } from './workspace';
import debounce = require('lodash.debounce');
import { isDefined, rankNamesBy } from './utils';

interface CsContext {
  cliPath: string;
  csWorkspace: CsWorkspace;
  csDiagnostics: CsDiagnostics;
  csRestApi: CsRestApi;
}

/**
 * Extension entry point
 * @param context
 */
export async function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('Activating extension...');

  const csWorkspace = setupStatusViewsAndWorkspace(context);

  ensureLatestCompatibleCliExists(context.extensionPath).then((cliStatus) => {
    csWorkspace.setCliStatus(cliStatus);
    if (!cliStatus.cliPath) {
      vscode.window.showErrorMessage(
        `Error initiating the CodeScene CLI: ${cliStatus.error || 'Unknown error starting extension'}`
      );
      return;
    }
    startExtension(context, cliStatus.cliPath, csWorkspace);
  });

  setupStatsCollector();
}

function setupStatusViewsAndWorkspace(context: vscode.ExtensionContext) {
  const csWorkspace = new CsWorkspace(context);
  context.subscriptions.push(csWorkspace);
  const csStatusBar = new CsStatusBar();
  const statusViewProvider = registerStatusViewProvider(context);
  context.subscriptions.push(
    csWorkspace.onDidExtensionStateChange((extensionState) => {
      csStatusBar.setOnline(isDefined(extensionState.session));
      statusViewProvider.update(extensionState);
    })
  );
  return csWorkspace;
}

function startExtension(context: vscode.ExtensionContext, cliPath: string, csWorkspace: CsWorkspace) {
  const csDiagnostics = new CsDiagnostics();
  const csContext: CsContext = {
    cliPath,
    csDiagnostics,
    csWorkspace,
    csRestApi: new CsRestApi(),
  };
  Reviewer.init(cliPath);
  setupTelemetry(cliPath);
  
  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnosticsCollection.init(context);
  createAuthProvider(context, csContext);
  registerCommands(context, csContext);
  registerCsDocProvider(context);
  addReviewListeners(context, csDiagnostics);

  // Add Review CodeLens support
  const codeLensProvider = new CsReviewCodeLensProvider();
  const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(
    reviewDocumentSelector(),
    codeLensProvider
  );
  context.subscriptions.push(codeLensProviderDisposable);

  outputChannel.appendLine('Extension is now active!');
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
  // asking the user to log in. Should only be called/available when codescene.isSignedIn is false.
  // (see package.json)
  const loginCommand = vscode.commands.registerCommand('codescene.signInWithCodeScene', () => {
    vscode.authentication.getSession(AUTH_TYPE, [], { createIfNone: true });
  });
  context.subscriptions.push(loginCommand);
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

function addRefactoringCodeAction(
  context: vscode.ExtensionContext,
  documentSelector: vscode.DocumentSelector,
  codeSmellFilter: (d: vscode.Diagnostic) => boolean
) {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(documentSelector, new CsRefactorCodeAction(codeSmellFilter), {
      providedCodeActionKinds: CsRefactorCodeAction.providedCodeActionKinds,
    })
  );
}

function requireReloadWindowFn(message: string) {
  return async () => {
    const result = await vscode.window.showInformationMessage(message, 'Reload');
    if (result === 'Reload') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  };
}

/**
 * Active functionality that requires a connection to a CodeScene server.
 */
async function enableRemoteFeatures(context: vscode.ExtensionContext, csContext: CsContext) {
  // Refactoring features
  const enableACE = getConfiguration('enableAutomatedCodeEngineering');
  if (enableACE) {
    await enableACECapabilities(context, csContext);
  }

  // If the feature flag is changed, alert the user that a reload is needed
  context.subscriptions.push(
    onDidChangeConfiguration(
      'enableAutomatedCodeEngineering',
      requireReloadWindowFn('VS Code needs to be reloaded to enable/disable this feature.')
    )
  );
}

async function enableACECapabilities(context: vscode.ExtensionContext, csContext: CsContext) {
  const { csRestApi, csDiagnostics, cliPath, csWorkspace } = csContext;
  const refactorCapabilities = await csRestApi.fetchRefactorPreflight();
  if (refactorCapabilities) {
    const refactoringSelector = toRefactoringDocumentSelector(refactorCapabilities.supported);
    const codeSmellFilter = (d: vscode.Diagnostic) =>
      d.code instanceof Object && refactorCapabilities.supported['code-smells'].includes(d.code.value.toString());

    const codeLensProvider = new CsRefactorCodeLensProvider(codeSmellFilter);
    context.subscriptions.push(codeLensProvider);
    const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(refactoringSelector, codeLensProvider);
    context.subscriptions.push(codeLensProviderDisposable);

    new CsRefactoringCommand(
      context,
      csRestApi,
      cliPath,
      codeLensProvider,
      codeSmellFilter,
      refactorCapabilities['max-input-loc']
    ).register();
    addRefactoringCodeAction(context, refactoringSelector, codeSmellFilter);

    // Force update diagnosticCollection to show the supported code smells indication
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      csDiagnostics.review(document, { skipCache: true });
    });

    // Use this scheme for the virtual documents when diffing the refactoring
    const uriQueryContentProvider = new (class implements vscode.TextDocumentContentProvider {
      provideTextDocumentContent(uri: vscode.Uri): string {
        return uri.query;
      }
    })();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider('tmp-diff', uriQueryContentProvider)
    );

    const refactoringsView = new RefactoringsView();
    context.subscriptions.push(refactoringsView);

    csWorkspace.setACEEnabled(refactorCapabilities);
    outputChannel.appendLine('AI refactoring features enabled');
  }
}

function createAuthProvider(context: vscode.ExtensionContext, csContext: CsContext) {
  const { csWorkspace } = csContext;
  const authProvider = new CsAuthenticationProvider(context, csWorkspace);

  // Provides the initial session - will enable remote features and update workspace state
  vscode.authentication.getSession(AUTH_TYPE, []).then((session) => {
    if (session) {
      enableRemoteFeatures(context, csContext);
      csWorkspace.setSession(session);
    }
  });

  // Handle login/logout session changes
  authProvider.onDidChangeSessions((e) => {
    if (e.added && e.added.length > 0) {
      enableRemoteFeatures(context, csContext);
      // We only have one session in this extension currently, so grabbing the first one is ok.
      csWorkspace.setSession(e.added[0]);
    } else {
      // Without the following getSession call, the login option in the accounts picker will not reappear!
      // This is probably refreshing the account picker under the hood
      vscode.authentication.getSession(AUTH_TYPE, []);
      csWorkspace.unsetSession();
      requireReloadWindowFn('VS Code needs to be reloaded after signing out.')();
      // TODO - Instead rewrite all online functionality to be easily toggled...
    }
  });
  context.subscriptions.push(authProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
