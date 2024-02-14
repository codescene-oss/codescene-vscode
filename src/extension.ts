import * as vscode from 'vscode';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import { getConfiguration, onDidChangeConfiguration } from './configuration';
import { CouplingDataProvider } from './coupling/coupling-data-provider';
import { ExplorerCouplingsView } from './coupling/explorer-couplings-view';
import { ScmCouplingsView } from './coupling/scm-couplings-view';
import CsDiagnosticsCollection, { CsDiagnostics } from './cs-diagnostics';
import { CsRestApi } from './cs-rest-api';
import { CsStatusBar } from './cs-statusbar';
import { categoryToDocsCode, registerCsDocProvider } from './csdoc';
import { ensureLatestCompatibleCliExists } from './download';
import { Git } from './git';
import { Links } from './links';
import { outputChannel } from './log';
import { CsRefactorCodeAction } from './refactoring/codeaction';
import { CsRefactorCodeLensProvider } from './refactoring/codelens';
import { CsRefactoringCommand } from './refactoring/command';
import { RefactoringsView } from './refactoring/refactorings-view';
import { CsReviewCodeLensProvider } from './review/codelens';
import Reviewer from './review/reviewer';
import { createRulesTemplate } from './rules-template';
import { StatsCollector } from './stats';
import Telemetry from './telemetry';
import { isDefined } from './utils';
import { CsWorkspace } from './workspace';
import debounce = require('lodash.debounce');

interface CsContext {
  cliPath: string;
  csWorkspace: CsWorkspace;
  csDiagnostics: CsDiagnostics;
  csRestApi: CsRestApi;
  csStatusBar: CsStatusBar;
}

/**
 * Extension entry point
 * @param context
 */
export async function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('Activating extension...');

  const cliPath = await ensureLatestCompatibleCliExists(context.extensionPath);
  const csRestApi = new CsRestApi();
  const csWorkspace = new CsWorkspace(context, csRestApi);
  context.subscriptions.push(csWorkspace);
  const supportedLanguages = getSupportedLanguages(context.extension);
  const csDiagnostics = new CsDiagnostics(supportedLanguages);
  const csStatusBar = new CsStatusBar();

  const csContext: CsContext = {
    cliPath,
    csRestApi,
    csWorkspace,
    csDiagnostics,
    csStatusBar,
  };

  Reviewer.init(cliPath);

  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnosticsCollection.init(context);

  createAuthProvider(context, csContext);

  setupTelemetry(cliPath);

  registerCommands(context, csContext);

  registerCsDocProvider(context);

  addReviewListeners(context, csDiagnostics);

  // Add Review CodeLens support
  const codeLensDocSelector = getSupportedDocumentSelector(supportedLanguages);
  const codeLensProvider = new CsReviewCodeLensProvider();
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

  outputChannel.appendLine('Extension is now active!');
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
    vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
      // avoid debouncing 'output' documents etc.
      if (e.document.uri.scheme === 'file') {
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
  outputChannel.appendLine('Change Coupling enabled');

  // Refactoring features
  const enableAiRefactoring = getConfiguration('enableAiRefactoring');
  if (enableAiRefactoring) {
    await enableAiRefactoringCapabilities(context, csContext);
  }

  // If the feature flag is changed, alert the user that a reload is needed
  onDidChangeConfiguration(
    'enableAiRefactoring',
    requireReloadWindowFn('VS Code needs to be reloaded to enable/disable this feature.')
  );
}

/**
 * Maps the preflight response file extensions to langauge identifiers supported by vscode.
 * https://code.visualstudio.com/docs/languages/identifiers#_known-language-identifiers
 */
function fileTypeToLanguageId(fileType: string) {
  switch (fileType) {
    case 'js':
    case 'mjs':
      return 'javascript';
    case 'jsx':
      return 'javascriptreact';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'typescriptreact';
  }
}

/**
 *
 * @param supportedFileTypes As defined by CodeScene preflight response
 * @returns A list of distinct DocumentSelectors for the supported file types
 */
function getRefactoringSelector(supportedFileTypes: string[]): vscode.DocumentSelector {
  const definedLangIds = supportedFileTypes.map(fileTypeToLanguageId).filter(isDefined);
  return [...new Set(definedLangIds)].map((language) => ({
    language,
    scheme: 'file',
  }));
}

async function enableAiRefactoringCapabilities(context: vscode.ExtensionContext, csContext: CsContext) {
  const { csRestApi, csDiagnostics, cliPath } = csContext;
  const refactorCapabilities = await csRestApi.fetchRefactorPreflight();
  if (refactorCapabilities) {
    const refactoringSelector = getRefactoringSelector(refactorCapabilities.supported['file-types']);
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

    outputChannel.appendLine('AI refactoring features enabled');
  }
}

function createAuthProvider(context: vscode.ExtensionContext, csContext: CsContext) {
  const { csWorkspace, csStatusBar } = csContext;
  const authProvider = new CsAuthenticationProvider(context, csWorkspace);

  // Provides the initial session - will enable remote features and update workspace state
  vscode.authentication.getSession(AUTH_TYPE, []).then((session) => {
    if (session) {
      csWorkspace.updateIsLoggedInContext(true);
      csStatusBar.setOnline(true);
      enableRemoteFeatures(context, csContext);
    }
  });

  // Handle login/logout session changes
  authProvider.onDidChangeSessions((e) => {
    if (e.added && e.added.length > 0) {
      csWorkspace.updateIsLoggedInContext(true);
      csStatusBar.setOnline(true);
      enableRemoteFeatures(context, csContext);
    } else {
      // Without the following getSession call, the login option in the accounts picker will not reappear!
      // This is probably refreshing the account picker under the hood
      vscode.authentication.getSession(AUTH_TYPE, []);
      csWorkspace.updateIsLoggedInContext(false);
      csStatusBar.setOnline(false);

      requireReloadWindowFn('VS Code needs to be reloaded after signing out.')();
      // TODO - Instead rewrite all online functionality to be easily toggled...
    }
  });
  context.subscriptions.push(authProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
