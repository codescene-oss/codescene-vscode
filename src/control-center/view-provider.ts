import vscode, {
  CancellationToken,
  ExtensionContext,
  Uri,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
} from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { logOutputChannel } from '../log';
import { ACECreditsError } from '../refactoring/api';
import { AceCredits } from '../refactoring/model';
import { pluralize } from '../utils';
import { getUri, nonce } from '../webview-utils';

export function registerControlCenterViewProvider(context: ExtensionContext) {
  const provider = new ControlCenterViewProvider(context.extensionUri);
  context.subscriptions.push(window.registerWebviewViewProvider('codescene.controlCenterView', provider));
  return provider;
}

export class ControlCenterViewProvider implements WebviewViewProvider /* , Disposable */ {
  private view?: WebviewView;

  constructor(private readonly extensionUri: Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: WebviewViewResolveContext,
    token: CancellationToken
  ): Thenable<void> | void {
    this.view = webviewView;
    const webView = this.view.webview;
    webView.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(this.extensionUri, 'out'), Uri.joinPath(this.extensionUri, 'assets')],
    };

    webView.onDidReceiveMessage(this.handleMessages, this);

    this.update();
  }

  private handleMessages(message: any) {
    switch (message.command) {
      case 'open-settings':
        void vscode.commands.executeCommand(
          'workbench.action.openWorkspaceSettings',
          '@ext:codescene.codescene-vscode'
        );
        return;
      case 'show-code-health-analysis-error':
      case 'show-ace-error':
        logOutputChannel.show();
        return;
      case 'open-documentation':
        void vscode.env.openExternal(vscode.Uri.parse('https://codescene.io/docs'));
        return;
      case 'open-terms-and-policies':
        void vscode.env.openExternal(vscode.Uri.parse('https://codescene.com/policies'));
        return;
      case 'open-ai-privacy-principles':
        void vscode.env.openExternal(vscode.Uri.parse('https://codescene.com/product/ace/principles'));
        return;
      case 'open-contact-codescene':
        void vscode.env.openExternal(vscode.Uri.parse('https://codescene.com/company/contact-us'));
        return;
      case 'copy-machine-id':
        void vscode.env.clipboard.writeText(vscode.env.machineId).then(() => {
          void vscode.window.showInformationMessage('Copied machine-id to clipboard.');
        });
        return;
    }
  }

  update() {
    if (!this.view) {
      return;
    }

    const webView = this.view.webview;
    webView.html = this.wrapWithBoilerplate(webView, this.getContent());
  }

  private wrapWithBoilerplate(webView: vscode.Webview, bodyContent?: string) {
    const webviewScript = getUri(webView, 'out', 'control-center', 'webview-script.js');
    const stylesUri = getUri(webView, 'out', 'control-center', 'styles.css');
    const codiconsUri = getUri(webView, 'out', 'codicons', 'codicon.css');

    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">

      <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${
            webView.cspSource
          }; font-src ${webView.cspSource}; style-src 'unsafe-inline' ${webView.cspSource};">

          <link href="${codiconsUri}" nonce="${nonce()}" type="text/css" rel="stylesheet" />
          <link href="${stylesUri}" nonce="${nonce()}" type="text/css" rel="stylesheet" />
      </head>

      <body>
        <script type="module" nonce="${nonce()}" src="${webviewScript}"></script>
        ${bodyContent ? bodyContent : ''}
      </body>

      </html>
    `;
  }

  private getContent() {
    return /*html*/ `
        ${this.accountGroup()}
        ${this.statusGroup()}
        ${this.moreGroup()}
        <div class="clickable" id="machine-id" title="Click to copy">machine-id:<br>${vscode.env.machineId}</div>
    `;
  }

  private accountGroup() {
    return /*html*/ `
    <div class="group">
        <div class="header">ACCOUNT</div>
        <div class="row">
            <div class="icon-and-text"><span class="codicon codicon-star"></span><span>Upgrade</span></div>
            <div class="badge">coming soon</div>
        </div>
    </div>  
    `;
  }

  private statusGroup() {
    return /*html*/ `
    <div class="group">
        <div class="header">STATUS</div>
        ${this.codeHealthAnalysisRow()}
        ${this.aceStatusRow()}
    </div>  
    `;
  }

  private codeHealthAnalysisRow() {
    const analysisFeature = CsExtensionState.stateProperties.features.analysis;
    let meta = { iconClass: '', text: '', badgeClass: '' };
    switch (analysisFeature.state) {
      case 'loading':
        meta = { iconClass: 'codicon-loading codicon-modifier-spin', text: 'initializing', badgeClass: '' };
        break;
      case 'enabled':
        meta = { iconClass: 'codicon-pulse', text: 'activated', badgeClass: 'badge-activated' };
        break;
      case 'error':
        meta = { iconClass: 'codicon-error', text: 'error', badgeClass: 'badge-error' };
        /* TODO - restore this in new UX somehow
          if (analysisState.error instanceof DownloadError) {
            const err = analysisState.error;
            const actionableMessage = `<p>
            Please try to installing the CodeScene devtools binary manually using these steps:
            <ul>
              <li>Download the required version manually from <a href="${err.url}">here</a></li>
              <li>Unpack and move it to ${err.expectedCliPath}</li>
              <li>Ensure it is executable, then restart the extension</li>
            </ul>
          </p>`;
          }
        */
        break;
    }

    return /*html*/ `
        <div class="row">
            <div class="icon-and-text"><span class="codicon ${
              meta.iconClass
            }"></span><span>Code Health Analysis</span></div>
            <div class="badge ${meta.badgeClass} ${
      meta.text === 'error' ? 'clickable' : ''
    }" id="code-health-analysis-badge">${meta.text}</div>
    </div>
    `;
  }

  private aceStatusRow() {
    const aceFeature = CsExtensionState.stateProperties.features.ace;

    let iconClass = 'codicon-sparkle',
      text = '',
      tooltip,
      outOfCreditsBanner;

    switch (aceFeature.state) {
      case 'loading':
        iconClass = 'codicon-loading codicon-modifier-spin';
        text = 'initializing';
        break;
      case 'enabled':
        iconClass = 'codicon-sparkle';
        text = 'activated';
        break;
      case 'disabled':
        iconClass = 'codicon-circle-slash';
        text = 'deactivated';
        tooltip = 'Disabled in configuration';
        break;
      case 'error':
        iconClass = 'codicon-error';
        text = 'error';
        break;
    }

    // Custom presentation if we're out of credits
    if (aceFeature.error instanceof ACECreditsError) {
      text = 'out of credits';
      outOfCreditsBanner = this.creditBannerContent(aceFeature.error.creditsInfo);
    }

    // Always in error if analysis failed to initialize
    if (CsExtensionState.stateProperties.features.analysis.state === 'error') {
      iconClass = 'codicon-error';
      text = 'error';
    }

    return /*html*/ `
        <div class="row">
            <div class="icon-and-text"><span class="codicon ${iconClass}"></span><span>CodeScene ACE</span></div>
            <div class="badge badge-${text} ${text === 'error' ? 'clickable' : ''}" 
              id="ace-badge"
              title="${tooltip ? tooltip : ''}">${text}
            </div>
        </div>
        ${outOfCreditsBanner ? outOfCreditsBanner : ''}
    `;
  }

  private creditBannerContent(creditInfo: AceCredits) {
    if (!creditInfo.resetTime) return;

    const differenceInDays = Math.floor((creditInfo.resetTime.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    const content = /* html*/ `
    <div class="out-of-credits-banner">
      <div class="icon-and-text">
        <span class="codicon codicon-warning warning"></span>
        <span class="bold">You're out of ACE credits</span>
      </div>
      <p>
        You'll get new credits in ${differenceInDays} ${pluralize(
      'day',
      differenceInDays
    )}. (${creditInfo.resetTime.toLocaleString()})
      </p>
    </div>
    `;
    return content;
  }

  private moreGroup() {
    return /*html*/ `
    <div class="group">
        <div class="header">MORE</div>
        <div class="row">
            <div class="icon-and-text clickable" id="codescene-settings"><span class="codicon codicon-settings-gear"></span><span>CodeScene Settings</span></div>
        </div>
        <div class="row">
            <div class="icon-and-text clickable" id="documentation"><span class="codicon codicon-question"></span><span>Documentation</span></div>
        </div>
        <div class="row">
            <div class="icon-and-text clickable" id="terms-and-policies"><span class="codicon codicon-file"></span><span>Terms & Policies</span></div>
        </div>
        <div class="row">
            <div class="icon-and-text clickable" id="privacy-principles"><span class="codicon codicon-file"></span><span>AI Privacy Principles</span></div>
        </div>
        <div class="row">
            <div class="icon-and-text clickable" id="contact-codescene"><span class="codicon codicon-comment-discussion"></span><span>Contact CodeScene</span></div>
        </div>
    </div>  
    `;
  }
}
