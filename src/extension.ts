import * as vscode from 'vscode';
import debounce = require('lodash.debounce');
import { review } from './codescene-interop';
import { ensureLatestCompatibleCliExists } from './download';
import path = require('path');
import { registerCsDocProvider } from './csdoc';
import { join } from 'path';
import { CsCodeLensProvider } from './codelens';
import { createRulesTemplate } from './rules-template';
import { outputChannel } from './log';

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
        vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.parse(`csdoc:${diag.code.value}.md`));
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
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('CodeScene: the extension is now active!');

  const cliPath = await ensureLatestCompatibleCliExists(context.extensionPath);

  registerCommands(context, cliPath);

  registerCsDocProvider(join(context.extensionPath, 'docs'));

  const supportedLanguages = getSupportedLanguages(context.extension);

  // Diagnostics provides the squigglies and also form the basis for the CodeLenses.
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('codescene');
  context.subscriptions.push(diagnosticCollection);

  // Add CodeLens support
  const codeLensDocSelector = getSupportedDocumentSelector(supportedLanguages);

  const codeLensProvider = new CsCodeLensProvider(cliPath);
  const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(codeLensDocSelector, codeLensProvider);
  context.subscriptions.push(codeLensProviderDisposable);

  // Diagnostics will be updated when a file is opened or when it is changed.
  const run = (document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, skipCache = false) => {
    if (document.uri.scheme !== 'file' || !supportedLanguages.includes(document.languageId)) {
      return;
    }
    review(cliPath, document, skipCache).then((diagnostics) => {
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
}

// This method is called when your extension is deactivated
export function deactivate() {}
