import * as vscode from 'vscode';
import debounce = require('lodash.debounce');
import { ensureLatestCompatibleCliExists } from './download';
import { categoryToDocsCode, registerCsDocProvider } from './csdoc';
import { CsCodeLensProvider } from './codelens';
import { createRulesTemplate } from './rules-template';
import { outputChannel } from './log';
import Telemetry from './telemetry';
import Reviewer from './review/reviewer';
import { StatsCollector } from './stats';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import { ScmCouplingsView } from './coupling/scm-couplings-view';
import { CsWorkspace } from './workspace';
import { Links } from './links';
import { CsRestApi, PreFlightResponse } from './cs-rest-api';
import { Git } from './git';
import { CouplingDataProvider } from './coupling/coupling-data-provider';
import { ExplorerCouplingsView } from './coupling/explorer-couplings-view';
import { CsRefactorCodeAction } from './refactoring/codeaction';
import { name as refactoringCommandName, CsRefactoringCommand } from './refactoring/command';
import { getConfiguration, onDidChangeConfiguration } from './configuration';
import CsDiagnosticsCollection, { CsDiagnostics } from './cs-diagnostics';

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
  console.log('CodeScene: Activating extension!');

  const cliPath = await ensureLatestCompatibleCliExists(context.extensionPath);
  const csRestApi = new CsRestApi();
  const csWorkspace = new CsWorkspace(context, csRestApi);
  context.subscriptions.push(csWorkspace);
  const supportedLanguages = getSupportedLanguages(context.extension);
  const csDiagnostics = new CsDiagnostics(supportedLanguages);

  const csContext: CsContext = {
    cliPath,
    csRestApi,
    csWorkspace,
    csDiagnostics,
  };

  Reviewer.init(cliPath);

  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnosticsCollection.init(context);

  createAuthProvider(context, csContext);

  setupTelemetry(cliPath);

  registerCommands(context, csContext);

  registerCsDocProvider(context);

  addReviewListeners(context, csDiagnostics);

  // Add CodeLens support
  const codeLensDocSelector = getSupportedDocumentSelector(supportedLanguages);
  const codeLensProvider = new CsCodeLensProvider();
  const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(codeLensDocSelector, codeLensProvider);
  context.subscriptions.push(codeLensProviderDisposable);

  // Setup a scheduled event for sending statistics
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

  console.log('CodeScene: Extension is now active!');
}

function getSupportedLanguages(extension: vscode.Extension<any>): string[] {
  return extension.packageJSON.activationEvents
    .filter((event: string) => event.startsWith('onLanguage:'))
    .map((event: string) => event.substring(11));
}

function getSupportedDocumentSelector(supportedLanguages: string[]) {
  return supportedLanguages.map((language) => ({ language, scheme: 'file' }));
}

function registerCommands(context: vscode.ExtensionContext, csContext: CsContext) {
  const { cliPath, csWorkspace } = csContext;

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
  // asking the user to log in. Should only be called/available when codescene.isLoggedIn is false.
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
    vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => debouncedRun(e.document))
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

function addRefactoringCodeAction(context: vscode.ExtensionContext, capabilities: PreFlightResponse) {
  const supportedLanguagesForRefactoring = capabilities.supported.languages.map((language) => ({
    language,
    scheme: 'file',
  }));
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      supportedLanguagesForRefactoring,
      new CsRefactorCodeAction(context, capabilities.supported['code-smells']),
      {
        providedCodeActionKinds: CsRefactorCodeAction.providedCodeActionKinds,
      }
    )
  );
}

/**
 * Active functionality that requires a connection to a CodeScene server.
 */
async function enableRemoteFeatures(context: vscode.ExtensionContext, csContext: CsContext) {
  const { csWorkspace, csRestApi } = csContext;
  const links = new Links(csWorkspace);
  context.subscriptions.push(links);

  const git = new Git();
  const couplingDataProvider = new CouplingDataProvider(git, csRestApi, csWorkspace);

  // Init tree view in scm container
  const couplingView = new ScmCouplingsView(git, couplingDataProvider);
  context.subscriptions.push(couplingView);

  // Init tree view in explorer container
  const explorerCouplingsView = new ExplorerCouplingsView(couplingDataProvider);
  context.subscriptions.push(explorerCouplingsView);

  // Refactoring features
  const enableAiRefactoring = getConfiguration('enableAiRefactoring');
  if (enableAiRefactoring) {
    await enableRefactoringCommand(context, csContext);
  }

  // If the feature flag is changed, alert the user that a reload is needed
  onDidChangeConfiguration('enableAiRefactoring', async (e) => {
    const result = await vscode.window.showInformationMessage(
      'CodeScene: VS Code needs to be reloaded to enable/disable this feature.',
      'Reload'
    );
    if (result === 'Reload') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  });
}

async function enableRefactoringCommand(context: vscode.ExtensionContext, csContext: CsContext) {
  const { csRestApi, csDiagnostics, cliPath } = csContext;
  const refactorCapabilities = await csRestApi.fetchRefactorPreflight();
  if (refactorCapabilities) {
    Reviewer.instance.setSupportedRefactoringSmells(refactorCapabilities.supported['code-smells']);

    // Force update diagnosticCollection to show the supported code smells indication
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      csDiagnostics.review(document, { skipCache: true });
    });

    const csRefactoringCommand = new CsRefactoringCommand(csRestApi, cliPath);
    const requestRefactoringCmd = vscode.commands.registerCommand(
      refactoringCommandName,
      csRefactoringCommand.requestRefactoring,
      csRefactoringCommand
    );
    context.subscriptions.push(requestRefactoringCmd);
    addRefactoringCodeAction(context, refactorCapabilities);

    // Use this scheme for the virtual documents when diffing the refactoring
    const uriQueryContentProvider = new (class implements vscode.TextDocumentContentProvider {
      provideTextDocumentContent(uri: vscode.Uri): string {
        return uri.query;
      }
    })();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider('tmp-diff', uriQueryContentProvider)
    );
  }
}

function createAuthProvider(context: vscode.ExtensionContext, csContext: CsContext) {
  const { csWorkspace } = csContext;
  const authProvider = new CsAuthenticationProvider(context, csWorkspace);

  // Provides the initial session - will enable remote features and update workspace state
  vscode.authentication.getSession(AUTH_TYPE, []).then((session) => {
    if (session) {
      csWorkspace.updateIsLoggedInContext(true);
      enableRemoteFeatures(context, csContext);
    }
  });

  // Handle login/logout session changes
  authProvider.onDidChangeSessions((e) => {
    if (e.added && e.added.length > 0) {
      csWorkspace.updateIsLoggedInContext(true);
      enableRemoteFeatures(context, csContext);
    } else {
      // Without the following getSession call, the login option in the accounts picker will not reappear!
      // This is probably refreshing the account picker under the hood
      vscode.authentication.getSession(AUTH_TYPE, []);
      csWorkspace.updateIsLoggedInContext(false);

      // TODO - disable/unload the remote features
    }
  });
  context.subscriptions.push(authProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
