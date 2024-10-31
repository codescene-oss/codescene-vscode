import path from 'path';
import vscode, { Disposable, Uri, ViewColumn, WebviewPanel } from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { FnToRefactor, RefactoringTarget } from '../refactoring/commands';
import { isDefined } from '../utils';
import { readRawMarkdownDocs, renderedSegment, renderHtmlTemplate } from '../webviews/doc-and-refac-common';
import { getUri } from '../webviews/utils';
import { InteractiveDocsParams } from './csdoc-provider';

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
        this.dispose();
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

    let hideRefactorButton = true;
    if (this.state.document && this.state.fnToRefactor) {
      hideRefactorButton = false;
    } else {
      this.attemptRefactoring(documentUri, issueInfo);
    }

    const docsHeader = this.documentationHeaderContent(hideRefactorButton, documentUri, issueInfo);
    const docsContent = await this.docsForCategory(issueInfo.category);

    renderHtmlTemplate(this.webViewPanel, this.extensionUri, {
      title,
      bodyContent: [docsHeader, docsContent],
      cssPaths: [['out', 'documentation', 'styles.css']],
      scriptPaths: [['out', 'documentation', 'webview-script.js']],
    });
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
   * - \#\# Example (optional)
   * - \#\# Solution (optional)
   *
   * @param category Used for getting correct .md documentation from docs
   * @returns
   */
  private async docsForCategory(category: string) {
    const docsGuide = readRawMarkdownDocs(category, 'issues', this.extensionUri);

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
      ${await renderedSegment(category, description)}
      ${await renderedSegment('Example', example)}
      ${await renderedSegment('Solution', solution)}
    `;
  }

  dispose() {
    DocumentationPanel.currentPanel = undefined;
    this.webViewPanel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  static createOrShow({
    issueInfo,
    documentUri,
    request,
    extensionUri,
  }: InteractiveDocsParams & { extensionUri: Uri }) {
    if (DocumentationPanel.currentPanel) {
      void DocumentationPanel.currentPanel.updateWebView({ issueInfo, documentUri, request });
      DocumentationPanel.currentPanel.webViewPanel.reveal(undefined, true);
      return;
    }

    // Otherwise, create a new web view panel.
    DocumentationPanel.currentPanel = new DocumentationPanel(extensionUri);
    void DocumentationPanel.currentPanel.updateWebView({ issueInfo, documentUri, request });
  }
}
