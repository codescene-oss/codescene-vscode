import * as vscode from 'vscode';
import debounce = require('lodash.debounce');
import { ensureLatestCompatibleCliExists } from './download';
import { categoryToDocsCode, registerCsDocProvider } from './csdoc';
import { join } from 'path';
import { CsCodeLensProvider } from './codelens';
import { createRulesTemplate } from './rules-template';
import { outputChannel } from './log';
import Telemetry from './telemetry';
import { CachingReviewer, FilteringReviewer, SimpleReviewer } from './review/reviewer';
import { StatsCollector } from './stats';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';

import { ScmCouplingsView } from './coupling/scm-couplings-view';
import { CsWorkspace } from './workspace';
import { Links } from './links';
import { CsRestApi } from './cs-rest-api';
import { Git } from './git';
import { CouplingDataProvider } from './coupling/coupling-data-provider';
import { ExplorerCouplingsView } from './coupling/explorer-couplings-view';
import { getConfiguration, onDidChangeConfiguration } from './configuration';
import { CsRefactorCodeAction, } from './refactoring/codeaction';
import { name as refactoringCommandName, requestRefactoring, refactorPreFlight } from './refactoring/command';

function getSupportedLanguages(extension: vscode.Extension<any>): string[] {
  return extension.packageJSON.activationEvents
    .filter((event: string) => event.startsWith('onLanguage:'))
    .map((event: string) => event.substring(11));
}

function getSupportedDocumentSelector(supportedLanguages: string[]) {
  return supportedLanguages.map((language) => ({ language, scheme: 'file' }));
}

function registerCommands(context: vscode.ExtensionContext, cliPath: string) {
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
      if (diag.code instanceof Object) {
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

  const refactoringCapabilities = refactorPreFlight();

  const requestRefactoringCmd = vscode.commands.registerCommand(refactoringCommandName, requestRefactoring);
  context.subscriptions.push(requestRefactoringCmd);
}

function setupTelemetry(cliPath: string) {
  Telemetry.init(cliPath);

  // send telemetry on activation (gives us basic usage stats)
  Telemetry.instance.logUsage('onActivateExtension');
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('CodeScene: the extension is now active!');

  const cliPath = await ensureLatestCompatibleCliExists(context.extensionPath);

  setupTelemetry(cliPath);

  registerCommands(context, cliPath);

  registerCsDocProvider(join(context.extensionPath, 'docs'));

  const supportedLanguages = getSupportedLanguages(context.extension);

  // Diagnostics provides the squigglies and also form the basis for the CodeLenses.
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('codescene');
  context.subscriptions.push(diagnosticCollection);

  const reviewer = new FilteringReviewer(new CachingReviewer(new SimpleReviewer(cliPath)));

  // Add CodeLens support
  const codeLensDocSelector = getSupportedDocumentSelector(supportedLanguages);

  const codeLensProvider = new CsCodeLensProvider(reviewer);
  const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(codeLensDocSelector, codeLensProvider);
  context.subscriptions.push(codeLensProviderDisposable);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'javascript' },
      new CsRefactorCodeAction(context),
      {
        providedCodeActionKinds: CsRefactorCodeAction.providedCodeActionKinds,
      }
    )
  );

  // Diagnostics will be updated when a file is opened or when it is changed.
  const run = (document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, skipCache = false) => {
    if (document.uri.scheme !== 'file' || !supportedLanguages.includes(document.languageId)) {
      return;
    }
    reviewer.review(document, { skipCache }).then((diagnostics) => {
      // Remove the diagnostics that are for file level issues.
      // These are only shown as code lenses
      const importantDiagnostics = diagnostics.filter((d) => d.range.start.line > 0);
      diagnosticCollection.set(document.uri, importantDiagnostics);
    });
  };

  // This provides the initial diagnostics when a file is opened.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
      run(document, diagnosticCollection);
    })
  );

  // For live updates, we debounce the runs to avoid consuming too many resources.
  const debouncedRun = debounce(run, 2000);
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) =>
      debouncedRun(e.document, diagnosticCollection)
    )
  );

  // This provides the initial diagnostics when the extension is first activated.
  vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
    run(document, diagnosticCollection);
  });

  // Use a file system watcher to rerun diagnostics when .codescene/code-health-rules.json changes.
  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/.codescene/code-health-rules.json');
  fileSystemWatcher.onDidChange((uri: vscode.Uri) => {
    outputChannel.appendLine(`code-health-rules.json changed, updating diagnostics`);
    vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
      run(document, diagnosticCollection, true);
    });
    codeLensProvider.update();
  });
  context.subscriptions.push(fileSystemWatcher);

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

  const enableRemoteFeaturesFF = getConfiguration<boolean>('enableRemoteFeatures');
  if (enableRemoteFeaturesFF) {
    enableRemoteFeatures(context);
  }

  // If the feature flag is changed, alert the user that a reload is needed
  onDidChangeConfiguration('enableRemoteFeatures', async (e) => {
    const result = await vscode.window.showInformationMessage(
      'CodeScene: VS Code needs to be reloaded to enable/disable remote features.',
      'Reload'
    );
    if (result === 'Reload') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  });
}

/**
 * Active functionality that requires a connection to a CodeScene server.
 */
async function enableRemoteFeatures(context: vscode.ExtensionContext) {
  const csRestApi = new CsRestApi();

  const csWorkspace = new CsWorkspace(context, csRestApi);
  csWorkspace.updateRemoteFeatureEnabledContext(true); // used in package.json to enable new views
  context.subscriptions.push(csWorkspace);

  const links = new Links(csWorkspace);
  context.subscriptions.push(links);

  await createAuthProvider(context, csWorkspace);

  const git = new Git();
  const couplingDataProvider = new CouplingDataProvider(git, csRestApi, csWorkspace);

  // Init tree view in scm container
  const couplingView = new ScmCouplingsView(git, couplingDataProvider);
  context.subscriptions.push(couplingView);

  // Init tree view in explorer container
  const explorerCouplingsView = new ExplorerCouplingsView(couplingDataProvider);
  context.subscriptions.push(explorerCouplingsView);
}

async function createAuthProvider(context: vscode.ExtensionContext, csWorkspace: CsWorkspace) {
  const authProvider = new CsAuthenticationProvider(context, csWorkspace);
  context.subscriptions.push(authProvider);

  const session = await vscode.authentication.getSession(AUTH_TYPE, [], { createIfNone: false });

  if (session) {
    csWorkspace.updateIsLoggedInContext(true);
  } else {
    csWorkspace.updateIsLoggedInContext(false);
  }

  authProvider.onDidChangeSessions(async (e) => {
    if (e.added && e.added.length > 0) {
      csWorkspace.updateIsLoggedInContext(true);
    } else {
      // Without the following getSession call, the login option in the accounts picker will not reappear!
      // No idea why.
      await vscode.authentication.getSession(AUTH_TYPE, [], { createIfNone: false });
      csWorkspace.updateIsLoggedInContext(false);
    }
  });

  return authProvider;
}

// This method is called when your extension is deactivated
export function deactivate() {}
