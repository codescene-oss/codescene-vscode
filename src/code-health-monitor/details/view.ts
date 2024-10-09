import { basename } from 'path';
import vscode, { Disposable, ExtensionContext, Uri, Webview, WebviewViewProvider } from 'vscode';
import { issueToDocsParams } from '../../documentation/csdoc-provider';
import { CsRefactoringRequest } from '../../refactoring/cs-refactoring-requests';
import { pluralize } from '../../utils';
import { getUri, nonce } from '../../webviews/utils';
import { DeltaFunctionInfo } from '../tree-model';

export function register(context: ExtensionContext) {
  const viewProvider = new CodeHealthDetailsView(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codescene.codeHealthDetailsView', viewProvider),
    vscode.commands.registerCommand('codescene.codeHealthDetailsView.showDetails', (functionInfo: DeltaFunctionInfo) =>
      viewProvider.update(functionInfo)
    )
  );
}

class CodeHealthDetailsView implements WebviewViewProvider, Disposable {
  private static placeholder = '___BODY_CONTENTS___';
  private disposables: Disposable[] = [];
  private view?: vscode.WebviewView;
  private baseContent: string = '';
  private functionInfo?: DeltaFunctionInfo;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this.view = webviewView;
    const webView = this.view.webview;
    webView.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(this.extensionUri, 'out'), Uri.joinPath(this.extensionUri, 'assets')],
    };

    webView.onDidReceiveMessage(this.messageHandler, this, this.disposables);

    this.baseContent = this.initBaseContent(webView);
    this.update();
  }

  private messageHandler(message: any) {
    switch (message.command) {
      case 'auto-refactor':
        void vscode.commands.executeCommand('codescene.presentRefactoring', this.functionInfo?.refactoring);
        return;
      case 'interactive-docs':
        const issue = this.functionInfo?.children[message.issueIndex];
        if (issue) {
          void vscode.commands.executeCommand(
            'codescene.openInteractiveDocsPanel',
            issueToDocsParams(issue, this.functionInfo?.refactoring)
          );
        }
        return;
    }
  }

  private initBaseContent(webView: Webview) {
    const webviewScript = getUri(
      webView,
      this.extensionUri,
      'out',
      'code-health-monitor',
      'details',
      'webview-script.js'
    );
    const styleSheet = getUri(webView, this.extensionUri, 'out', 'code-health-monitor', 'details', 'styles.css');
    const codiconsUri = getUri(webView, this.extensionUri, 'out', 'codicons', 'codicon.css');

    return /*html*/ `
    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${
          webView.cspSource
        }; font-src ${webView.cspSource}; style-src 'unsafe-inline' ${webView.cspSource};">

        <link href="${codiconsUri}" nonce="${nonce()}" type="text/css" rel="stylesheet" />
        <link href="${styleSheet}" nonce="${nonce()}" type="text/css" rel="stylesheet" />
    </head>

    <body>
        ${CodeHealthDetailsView.placeholder}
        <script type="module" nonce="${nonce()}" src="${webviewScript}"></script>
    </body>

    </html>
  `;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  update(functionInfo?: DeltaFunctionInfo) {
    this.functionInfo = functionInfo;
    const webView = this.view?.webview;
    if (!webView) return;
    webView.html = this.baseContent.replace(
      CodeHealthDetailsView.placeholder,
      functionInfo ? this.functionInfoContent(functionInfo) : this.defaultContent()
    );
  }

  private defaultContent() {
    return /*html*/ `<p>Select a function to view detailed information and its impact on Code Health.</p>`;
  }

  private functionInfoContent(functionInfo: DeltaFunctionInfo) {
    return `
    ${this.fileAndFunctionInfo(functionInfo)}
    ${this.functionDescription(functionInfo)}
    ${this.refactoringButton(functionInfo.refactoring)}
    ${this.issueDetails(functionInfo)}
    `;
  }

  private fileAndFunctionInfo(functionInfo: DeltaFunctionInfo) {
    const fileName = basename(functionInfo.parent.uri.fsPath);
    return /*html*/ `
      <div class="block function-info">
        <div class="function-name flex-row large"><span class="codicon codicon-symbol-method"></span><span>${functionInfo.fnName}</span></div>
        <div class="function-coordinate flex-row">
          <div class="flex-row">${fileName}</div> <!-- TODO seti file type theme icon ? -->
          <div class="flex-row"><span class="codicon codicon-list-flat"></span> Line:${functionInfo.range.start.line}</div>
        </div>
      </div>
    `;
  }

  private functionDescription(functionInfo: DeltaFunctionInfo) {
    const categories = functionInfo.children.map((issue) => issue.changeDetail.category);
    const description =
      categories.length > 0 &&
      /*html*/ `
      <div class="block">
        <p>CodeScene identified the following code ${pluralize('smell', categories.length)}: <strong>${categories.join(
        ', '
      )}</strong> resulting in a decline in Code Health.
        </p>
      </div>`;

    return description ? description : '';
  }

  private refactoringButton(refactoring?: CsRefactoringRequest) {
    const buttonWithProps = (iconClass = 'codicon-sparkle', appearance = 'primary', disabled = false) => {
      return /*html*/ `
        <vscode-button id="auto-refactor" appearance="${appearance}" ${disabled ? 'disabled' : ''}>
          <span slot="start" class="codicon ${iconClass}"></span>
          Auto-refactor
        </vscode-button>`;
    };
    let refacButton = buttonWithProps();

    if (!refactoring?.shouldPresent()) {
      refacButton = buttonWithProps('codicon-circle-slash', 'secondary', true);
    }

    if (refactoring?.isPending()) {
      refacButton = buttonWithProps('codicon-loading codicon-modifier-spin');
      void refactoring.promise.then(() => {
        this.update(this.functionInfo);
      });
    }
    return /*html*/ `
    <div class="block">
      ${refacButton}
      <!-- <vscode-button id="cancel" appearance="secondary"><span class="codicon codicon-circle-slash"></span></vscode-button> -->
    </div>`;
  }

  private issueDetails(functionInfo: DeltaFunctionInfo) {
    const issueDetails = functionInfo.children.map(
      (issue, ix) => /*html*/ `
      <div class="issue">
        <div class="flex-row">
          <span class="codicon codicon-warning"></span> 
          <strong>${issue.changeDetail.category}</strong>
          <a href="" class="issue-icon-link" issue-index="${ix}"><span class="codicon codicon-link-external"></span></a>
        </div>
        ${issue.changeDetail.description}
      </div>
      `
    );
    if (issueDetails.length === 0) return '';
    return /*html*/ `
      <div class="block issue-details">
        ${issueDetails.join('')}
      </div>`;
  }
}
