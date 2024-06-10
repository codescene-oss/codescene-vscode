import { readFile } from 'fs/promises';
import path, { join } from 'path';
import vscode, { Disposable, Uri, ViewColumn, WebviewPanel } from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { FnToRefactor } from '../refactoring/commands';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import Reviewer from '../review/reviewer';
import { getLogoUrl, isDefined } from '../utils';
import { nonce } from '../webviews/utils';
import { categoryToDocsCode } from './csdoc-provider';
import { logOutputChannel } from '../log';

export interface CategoryWithPosition {
  category: string;
  position: vscode.Position;
}

interface DocPanelParams {
  codeSmell: CategoryWithPosition;
  documentUri: Uri;
  refactoring?: CsRefactoringRequest; // If there already is a refactoring available?
}

type DocPanelState = DocPanelParams & {
  fnToRefactor?: FnToRefactor; // The function to refactor if applicable
  document?: vscode.TextDocument; // The opened document containing a fn to refactor
};

export class DocumentationPanel implements Disposable {
  public static currentPanel: DocumentationPanel | undefined;
  private static readonly viewType = 'documentationPanel';
  private readonly webViewPanel: WebviewPanel;
  private disposables: Disposable[] = [];
  private state: DocPanelState | undefined;

  constructor(private extensionUri: Uri) {
    this.webViewPanel = vscode.window.createWebviewPanel(
      DocumentationPanel.viewType,
      'CodeScene',
      { viewColumn: ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(extensionUri, 'out'), Uri.joinPath(extensionUri, 'assets')],
      }
    );
    this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webViewPanel.webview.onDidReceiveMessage(this.handleWebViewMessage.bind(this), null, this.disposables);
  }

  private async handleWebViewMessage(message: any) {
    switch (message.command) {
      case 'initiate-refactoring':
        this.initiateRefactoring();
        return;
      case 'goto-function-location':
        this.goToFunctionLocation();
        return;
    }
  }

  private initiateRefactoring() {
    if (!this.state) return;
    if (this.state.refactoring) {
      void vscode.commands.executeCommand('codescene.presentRefactoring', this.state.refactoring, ViewColumn.Active);
      return;
    }

    if (this.state.fnToRefactor && this.state.document) {
      void vscode.commands.executeCommand(
        'codescene.requestAndPresentRefactoring',
        this.state.document,
        this.state.fnToRefactor,
        this.state.codeSmell.position.line
      );
    }
  }

  private goToFunctionLocation() {
    if (!this.state) return;
    const uri = this.state.documentUri;

    /**
     * Need to do this because the goToLocations command expects a proper vscode.Position,
     * not a {line, character} object which we might get when coming from a diagnostic
     * target uri (where args are encoded as query params). The uri is fine though ¯\_(ツ)_/¯
     */
    const { line, character } = this.state.codeSmell.position;
    const position = new vscode.Position(line, character);

    const location = new vscode.Location(uri, position);
    void vscode.commands.executeCommand('editor.action.goToLocations', uri, position, [location]);
  }

  private async updateWebView(params: DocPanelParams) {
    const {
      codeSmell: { category, position },
      documentUri,
    } = params;
    this.state = params;

    const title = category;
    this.webViewPanel.title = `CodeScene - ${title}`;
    
    const webviewScript = this.getUri('out', 'documentation', 'webview-script.js');
    const markdownLangCss = this.getUri('assets', 'markdown-languages.css');
    const documentationCss = this.getUri('assets', 'documentation-styles.css');
    const codiconsUri = this.getUri('out', 'codicons', 'codicon.css');
    const csLogoUrl = await getLogoUrl(this.extensionUri.fsPath);

    if (CsExtensionState.acePreflight) {
      // Asynchronously open doc and find refactorable function, then posting a message back to the
      // webview to show the refactor button. (see webview-script.ts)
      void vscode.workspace.openTextDocument(documentUri).then((document) => {
        void this.findRefactorableFunction(document, position.line).then((fnToRefactor) => {
          if (!this.state) return;
          this.state.document = document;
          this.state.fnToRefactor = fnToRefactor;
          void this.webViewPanel.webview.postMessage({
            command: 'show-refactor-button',
            args: [isDefined(fnToRefactor)],
          });
        });
      });
    }

    const docsContent = await this.docsForCategory(category);

    const webView = this.webViewPanel.webview;
    webView.html = /*html*/ `
    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src data: ${webView.cspSource}; script-src ${webView.cspSource}; font-src ${
      webView.cspSource
    };
          style-src 'unsafe-inline' ${webView.cspSource};"
        />
        <link href="${markdownLangCss}" type="text/css" rel="stylesheet" />
        <link href="${documentationCss}" type="text/css" rel="stylesheet" />
        <link href="${codiconsUri}" type="text/css" rel="stylesheet" />
    </head>

    <body>
        <script type="module" nonce="${nonce()}" src="${webviewScript}"></script>
        <h1><img src="data:image/png;base64,${csLogoUrl}" width="64" height="64" align="center"/>&nbsp; ${title}</h1>

        ${this.documentationHeaderContent(documentUri, position)}
        <br>
        ${docsContent}
    </body>

    </html>
    `;
  }

  private documentationHeaderContent(uri: Uri, position: vscode.Position) {
    const fileName = path.basename(uri.path);
    return /*html*/ `
    <div class="documentation-header">
      <div id="function-location" title="Go to line ${position.line + 1} in ${fileName}">
        <span>${fileName}</span><span class="line-no">:L${position.line + 1}</span>
      </div>
      <vscode-button id="refactoring-button" class="hidden">
        <span slot="start" class="codicon codicon-sparkle"></span>
        Auto-refactor
      </vscode-button>
    </div>
    <hr>
  `;
  }

  private async findRefactorableFunction(document: vscode.TextDocument, lineNo: number) {
    const diagnostics = await Reviewer.instance.review(document).diagnostics;
    const diagnosticsAtLine = diagnostics.filter((d) => d.range.start.line === lineNo);

    const fnToRefactor = await vscode.commands.executeCommand<FnToRefactor | undefined>(
      'codescene.getFunctionToRefactor',
      document,
      diagnosticsAtLine,
      lineNo
    );
    return fnToRefactor;
  }

  private async docsForCategory(category: string) {
    const docsPath = categoryToDocsCode(category);
    const path = join(this.extensionUri.fsPath, 'docs', 'issues', `${docsPath}.md`);
    const docsGuide = await readFile(path);
    return vscode.commands.executeCommand<string>('markdown.api.render', docsGuide.toString());
  }

  private getUri(...pathSegments: string[]) {
    return this.webViewPanel.webview.asWebviewUri(Uri.joinPath(this.extensionUri, ...pathSegments));
  }

  dispose() {
    DocumentationPanel.currentPanel = undefined;
    this.webViewPanel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  static createOrShow({ codeSmell, documentUri, refactoring, extensionUri }: DocPanelParams & { extensionUri: Uri }) {
    if (DocumentationPanel.currentPanel) {
      void DocumentationPanel.currentPanel.updateWebView({ codeSmell, documentUri, refactoring });
      DocumentationPanel.currentPanel.webViewPanel.reveal(undefined, true);
      return;
    }

    // Otherwise, create a new web view panel.
    DocumentationPanel.currentPanel = new DocumentationPanel(extensionUri);
    void DocumentationPanel.currentPanel.updateWebView({ codeSmell, documentUri, refactoring });
  }
}
