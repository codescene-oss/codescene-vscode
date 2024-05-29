import { readFile } from 'fs/promises';
import path, { join } from 'path';
import vscode, { Disposable, TextDocument, Uri, ViewColumn, WebviewPanel } from 'vscode';
import { FnToRefactor } from '../refactoring/commands';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import Reviewer from '../review/reviewer';
import { getLogoUrl, isDefined } from '../utils';
import { nonce } from '../webviews/utils';
import { categoryToDocsCode } from './csdoc-provider';

export interface CategoryWithPosition {
  category: string;
  position: vscode.Position;
}

interface DocPanelParams {
  codeSmell: CategoryWithPosition;
  document: TextDocument;
  refactoring?: CsRefactoringRequest; // If there already is a refactoring available?
}

type DocPanelState = DocPanelParams & {
  fnToRefactor?: FnToRefactor; // If the docs for the code-smell at the
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
    }
  }

  private initiateRefactoring() {
    if (!this.state) return;
    if (this.state.refactoring) {
      void vscode.commands.executeCommand('codescene.presentRefactoring', this.state.refactoring, ViewColumn.Active);
      return;
    }

    if (this.state.fnToRefactor) {
      void vscode.commands.executeCommand(
        'codescene.requestAndPresentRefactoring',
        this.state.document,
        this.state.fnToRefactor,
        this.state.codeSmell.position.line
      );
    }
  }

  private async updateWebView(params: DocPanelParams) {
    // this.webViewPanel.title = category; // <- update title to something?
    const {
      codeSmell: { category, position },
      document,
    } = params;
    const fileName = path.basename(document.fileName);
    this.state = params;

    const title = category;
    const webviewScript = this.getUri('out', 'documentation', 'webview-script.js');
    const markdownLangCss = this.getUri('assets', 'markdown-languages.css');
    const documentationCss = this.getUri('assets', 'refactor-styles.css');
    const csLogoUrl = await getLogoUrl(this.extensionUri.fsPath);
    const webView = this.webViewPanel.webview;

    this.state.fnToRefactor = await this.showRefactorButton(document, position.line);
    const refactoringPossible = isDefined(this.state.fnToRefactor);

    const docsContent = await this.docsForCategory(category);

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
    </head>

    <body>
        <script type="module" nonce="${nonce()}" src="${webviewScript}"></script>
        <h1><img src="data:image/png;base64,${csLogoUrl}" width="64" height="64" align="center"/>&nbsp; ${title}</h1>

        <p>
          <code>${fileName}</code> contains a ${category} code-smell at line ${position.line + 1}.
        </p>

        ${refactoringPossible ? '<vscode-button id="refactoring-button">Suggest refactoring</vscode-button>' : ''}
        <hr>
        <br>
        ${docsContent}
    </body>

    </html>
    `;
  }

  private async showRefactorButton(document: vscode.TextDocument, lineNo: number) {
    if (!this.state) return;

    const diagnostics = await Reviewer.instance.review(document).diagnostics;
    const diagnosticsAtLine = diagnostics.filter((d) => d.range.start.line === lineNo);

    const fnToRefactor = await vscode.commands.executeCommand<FnToRefactor | undefined>(
      'codescene.getFunctionToRefactor',
      this.state.document,
      diagnosticsAtLine,
      this.state.codeSmell.position.line
    );
    this.state.fnToRefactor = fnToRefactor;
    return fnToRefactor;
  }

  private async docsForCategory(category: string) {
    const docsPath = categoryToDocsCode(category);
    const path = join(this.extensionUri.fsPath, 'docs', `${docsPath}.md`);
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

  static createOrShow({ codeSmell, document, refactoring, extensionUri }: DocPanelParams & { extensionUri: Uri }) {
    if (DocumentationPanel.currentPanel) {
      void DocumentationPanel.currentPanel.updateWebView({ codeSmell, document, refactoring });
      DocumentationPanel.currentPanel.webViewPanel.reveal(undefined, true);
      return;
    }

    // Otherwise, create a new web view panel.
    DocumentationPanel.currentPanel = new DocumentationPanel(extensionUri);
    void DocumentationPanel.currentPanel.updateWebView({ codeSmell, document, refactoring });
  }
}
