import { readFile } from 'fs/promises';
import path, { join } from 'path';
import vscode, { Disposable, Uri, ViewColumn, WebviewPanel } from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { FnToRefactor, RefactoringTarget } from '../refactoring/commands';
import { isDefined } from '../utils';
import { getUri, nonce } from '../webviews/utils';
import { categoryToDocsCode, InteractiveDocsParams } from './csdoc-provider';

export interface IssueInfo {
  category: string;
  position: vscode.Position;
  fnName?: string;
}

type DocPanelState = InteractiveDocsParams & {
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
      { viewColumn: ViewColumn.Beside },
      {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(extensionUri, 'out'), Uri.joinPath(extensionUri, 'assets')],
        retainContextWhenHidden: true, // Need this to keep the state of the auto-refactor button then moving the webview tab around
      }
    );
    this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webViewPanel.webview.onDidReceiveMessage(this.handleWebViewMessage.bind(this), null, this.disposables);
  }

  private async handleWebViewMessage(message: any) {
    if (!this.state) return;
    switch (message.command) {
      case 'show-refactoring':
        this.showRefactoring(this.state);
        return;
      case 'goto-function-location':
        this.goToFunctionLocation(this.state);
        return;
    }
  }

  private showRefactoring(state: DocPanelState) {
    if (state.request) {
      void vscode.commands.executeCommand('codescene.presentRefactoring', state.request, ViewColumn.Active);
    }
  }

  private goToFunctionLocation(state: DocPanelState) {
    const uri = state.documentUri;

    /**
     * Need to do this because the goToLocations command expects a proper vscode.Position,
     * not a {line, character} object which we might get when coming from a diagnostic
     * target uri (where args are encoded as query params). The uri is fine though ¯\_(ツ)_/¯
     */
    const { line, character } = state.issueInfo.position;
    const position = new vscode.Position(line, character);

    const location = new vscode.Location(uri, position);
    void vscode.commands.executeCommand('editor.action.goToLocations', uri, position, [location]);
  }

  private async updateWebView(params: InteractiveDocsParams) {
    const { issueInfo, documentUri } = params;

    // Set webview state (including request if available)
    this.state = params;
    if (this.state.request) {
      this.state.document = this.state.request.document;
      this.state.fnToRefactor = this.state.request.fnToRefactor;
    }

    const title = issueInfo.category;
    this.webViewPanel.title = title;

    const webviewScript = this.getUri('out', 'documentation', 'webview-script.js');
    const documentationCss = this.getUri('out', 'documentation', 'styles.css');
    const markdownLangCss = this.getUri('assets', 'markdown-languages.css');
    const highlightCss = this.getUri('assets', 'highlight.css');
    const codiconsUri = this.getUri('out', 'codicons', 'codicon.css');

    let hideRefactorButton = true;
    if (this.state.document && this.state.fnToRefactor) {
      hideRefactorButton = false;
    } else {
      this.attemptRefactoring(documentUri, issueInfo);
    }

    const docsContent = await this.docsForCategory(issueInfo.category);

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
        <link href="${highlightCss}" type="text/css" rel="stylesheet" />
        <link href="${documentationCss}" type="text/css" rel="stylesheet" />
        <link href="${codiconsUri}" type="text/css" rel="stylesheet" />
    </head>

    <body>
        <script type="module" nonce="${nonce()}" src="${webviewScript}"></script>
        <h2>${title}</h2>
        ${this.documentationHeaderContent(hideRefactorButton, documentUri, issueInfo)}
        ${docsContent}
    </body>

    </html>
    `;
  }

  private documentationHeaderContent(hideRefactorButton: boolean, uri: Uri, issueInfo: IssueInfo) {
    const { position, fnName } = issueInfo;
    const fileName = path.basename(uri.path);

    const fnNameHtml = fnName
      ? `<span class="codicon codicon-symbol-method"></span>
        ${fnName}`
      : '';

    return /*html*/ `
    <div class="documentation-header">
      <div id="function-location" class="flex-row">
        <span class="file-name">${fileName}</span>
        ${fnNameHtml}
        <span class="line-no">[Ln ${position.line + 1}]</span>
      </div>
      <hr>
      <vscode-button id="refactoring-button" class="${hideRefactorButton ? 'hidden' : ''}">
        <span slot="start" class="codicon codicon-sparkle"></span>
        Auto-refactor
      </vscode-button>
    </div>
  `;
  }

  /**
   * This function attempts to find a refactorable function in the document at the given line.
   * If found, it will post for a refactoring, save the request reference, and at the same time
   * send a message to the webview to show the refactor button.
   */
  private attemptRefactoring(documentUri: Uri, issueInfo: IssueInfo) {
    if (CsExtensionState.acePreflight) {
      // Asynchronously open doc and find refactorable function, then posting a message back to the
      // webview to show the refactor button. (see webview-script.ts)
      void vscode.workspace.openTextDocument(documentUri).then((document) => {
        void this.findRefactorableFunction(document, issueInfo).then((fnToRefactor) => {
          if (!this.state) return;
          this.state.document = document;
          this.state.fnToRefactor = fnToRefactor;
          void this.initiateRefactoring(this.state);
          void this.webViewPanel.webview.postMessage({
            command: 'show-refactor-button',
            args: [isDefined(fnToRefactor)],
          });
        });
      });
    }
  }

  private async findRefactorableFunction(document: vscode.TextDocument, issueInfo: IssueInfo) {
    const refactoringTarget: RefactoringTarget = { category: issueInfo.category, line: issueInfo.position.line + 1 };
    const fnToRefactor = await vscode.commands.executeCommand<FnToRefactor | undefined>(
      'codescene.getFunctionToRefactor',
      document,
      [refactoringTarget]
    );
    return fnToRefactor;
  }

  private async initiateRefactoring(state: DocPanelState) {
    if (state.fnToRefactor && state.document) {
      state.request = await vscode.commands.executeCommand(
        'codescene.initiateRefactoringForFunction',
        state.document,
        state.fnToRefactor
      );
    }
  }

  /**
   * This relies on the docs being in the correct format, with the following sections (in order!):
   * - Description text
   * - ## Example (optional)
   * - ## Solution (optional)
   * 
   * @param category Used for getting correct .md documentation from docs
   * @returns 
   */
  private async docsForCategory(category: string) {
    const docsPath = categoryToDocsCode(category);
    const path = join(this.extensionUri.fsPath, 'docs', 'issues', `${docsPath}.md`);
    const docsGuide = (await readFile(path)).toString().trim();

    let description = docsGuide,
      exampleAndSolution,
      example,
      solution;
    if (docsGuide.includes('## Solution')) {
      if (docsGuide.includes('## Example')) {
        [description, exampleAndSolution] = docsGuide.split('## Example');
        [example, solution] = exampleAndSolution.split('## Solution');
      } else {
        [description, solution] = docsGuide.split('## Solution');
      }
    }

    return /*html*/ `
    <div>
      ${await vscode.commands.executeCommand<string>('markdown.api.render', description)}
      ${await this.renderedSegment('Example', example)}
      ${await this.renderedSegment('Solution', solution)}
      </div>
    `;
  }

  private async renderedSegment(title: string, markdown?: string) {
    if (!markdown) return '';
    const html = await vscode.commands.executeCommand<string>('markdown.api.render', markdown.trim());
    return /*html*/ `
      <h3 class="${title.toLowerCase()}-header clickable">
        <span class="codicon codicon-chevron-down expand-indicator"></span>
        ${title}
      </h3>
      <div class="container ${title.toLowerCase()}-container">
        ${html}
      </div>
    `;
  }

  private getUri(...pathSegments: string[]) {
    return getUri(this.webViewPanel.webview, this.extensionUri, ...pathSegments);
  }

  dispose() {
    DocumentationPanel.currentPanel = undefined;
    this.webViewPanel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  static createOrShow({
    issueInfo: codeSmell,
    documentUri,
    request,
    extensionUri,
  }: InteractiveDocsParams & { extensionUri: Uri }) {
    if (DocumentationPanel.currentPanel) {
      void DocumentationPanel.currentPanel.updateWebView({ issueInfo: codeSmell, documentUri, request });
      DocumentationPanel.currentPanel.webViewPanel.reveal(undefined, true);
      return;
    }

    // Otherwise, create a new web view panel.
    DocumentationPanel.currentPanel = new DocumentationPanel(extensionUri);
    void DocumentationPanel.currentPanel.updateWebView({ issueInfo: codeSmell, documentUri, request });
  }
}
