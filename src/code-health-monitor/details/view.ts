import { basename } from 'path';
import vscode, { Disposable, ExtensionContext, Webview, WebviewViewProvider } from 'vscode';
// CS-5069 Remove ACE from public version
// import { refactoringButton } from '../../codescene-tab/webview/refactoring-components';
import { issueToDocsParams } from '../../documentation/commands';
import Telemetry from '../../telemetry';
import { commonResourceRoots, getUri, nonce } from '../../webview-utils';
import {  isDegradation } from '../presentation';
import { DeltaFunctionInfo, sortIssues } from '../tree-model';
import { ChangeType } from '../../devtools-api/delta-model';

export function register(context: ExtensionContext) {
  const viewProvider = new CodeHealthDetailsView();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codescene.codeHealthDetailsView', viewProvider),
    vscode.commands.registerCommand('codescene.codeHealthDetailsView.showDetails', (functionInfo?: DeltaFunctionInfo) =>
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

  constructor() {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this.view = webviewView;
    const webView = this.view.webview;
    webView.options = {
      enableScripts: true,
      localResourceRoots: commonResourceRoots(),
    };
    webView.onDidReceiveMessage(this.messageHandler, this, this.disposables);

    this.handleVisibilityEvents(webviewView);
    this.baseContent = this.initBaseContent(webView);
    this.update();
  }

  private handleVisibilityEvents(view: vscode.WebviewView) {
    // On first resolve ("resolveWebviewView is called when a view first becomes visible")
    Telemetry.logUsage('code-health-details/visibility', { visible: view.visible });
    view.onDidChangeVisibility(
      // On subsequent visibility changes (void event - use view.visible)
      () => Telemetry.logUsage('code-health-details/visibility', { visible: view.visible }),
      this,
      this.disposables
    );
  }

  private messageHandler(message: any) {
    switch (message.command) {
    // CS-5069 Remove ACE from public version
    //   case 'request-and-present-refactoring':
    //     void vscode.commands.executeCommand(
    //       'codescene.requestAndPresentRefactoring',
    //       this.functionInfo?.parent.document,
    //       'code-health-details',
    //       this.functionInfo?.fnToRefactor
    //     );
    //     return;
      case 'interactive-docs':
        const issue = this.functionInfo?.children[message.issueIndex];
        if (issue) {
          void vscode.commands.executeCommand(
            'codescene.openInteractiveDocsPanel',
            issueToDocsParams(issue, this.functionInfo),
            'code-health-details'
          );
        }
        return;
    }
  }

  private initBaseContent(webView: Webview) {
    const webviewScript = getUri(webView, 'out', 'code-health-monitor', 'details', 'webview-script.js');
    const styleSheet = getUri(webView, 'out', 'code-health-monitor', 'details', 'styles.css');
    const codiconsUri = getUri(webView, 'out', 'codicons', 'codicon.css');

    return /*html*/ `
    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${
          webView.cspSource
        }; font-src ${webView.cspSource}; style-src 'unsafe-inline' ${webView.cspSource};">

        <link href="${codiconsUri}" nonce="${nonce()}" type="text/css" rel="stylesheet" id="vscode-codicon-stylesheet" />
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
    const webView = this.view?.webview;
    if (!webView) return;
    this.functionInfo = functionInfo;

    let content = '';
    if (functionInfo) {
      content = this.functionInfoContent(functionInfo);
      const {/* isRefactoringSupported,*/ children } = functionInfo;
      Telemetry.logUsage('code-health-details/function-selected', {
        visible: this.view?.visible,
        isRefactoringSupported: false, // CS-5069 Remove ACE from public version
        nIssues: children.length,
      });
    } else {
      content = this.defaultContent();
      Telemetry.logUsage('code-health-details/function-deselected', { visible: this.view?.visible });
    }

    webView.html = this.baseContent.replace(CodeHealthDetailsView.placeholder, content);
  }

  private defaultContent() {
    return /*html*/ `<p>Select a function to view detailed information and its impact on Code Health.</p>`;
  }

  private functionInfoContent(functionInfo: DeltaFunctionInfo) {
    return `
    ${this.fileAndCodeSmellSummary(functionInfo)}` +
    // CS-5069 Remove ACE from public version
    //  <div class="block">
    //    ${refactoringButton(functionInfo.fnToRefactor)}
    //  </div>
    `${this.issueDetails(functionInfo)}
    `;
  }

  private fileAndCodeSmellSummary(functionInfo: DeltaFunctionInfo) {
    const fileName = basename(functionInfo.parent.document.uri.fsPath);
    return /*html*/ `
      <div class="block function-summary">
        <div class="flex-row filename-and-smell">
          <div class="flex-row"><span class="codicon codicon-file"></span>${fileName}</div>
          <div class="flex-row"><span class="codicon codicon-symbol-function"></span>${functionInfo.fnName}</div>
        </div>
      </div>
    `;
  }

  private issueDetails(functionInfo: DeltaFunctionInfo) {
    const iconClass = (changeType: ChangeType) => {
      if (isDegradation(changeType)) return 'codicon-chrome-close color-degraded';
      if (changeType === 'improved') return 'codicon-arrow-up color-improved';
      if (changeType === 'fixed') return 'codicon-check color-fixed';
      return 'codicon-circle-small-filled';
    };

    const issueDetails = functionInfo.children.sort(sortIssues).map(
      (issue, ix) => /*html*/ `
      <div class="issue">
        <div class="flex-row">
          <span class="codicon ${iconClass(issue.changeDetail['change-type'])}"></span> 
          <strong>${capitalize(issue.changeDetail['change-type'])}: </strong>
          <a href="" class="issue-link" issue-index="${ix}">${issue.changeDetail.category}</a>
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

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
