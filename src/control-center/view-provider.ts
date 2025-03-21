import vscode, {
  CancellationToken,
  Disposable,
  ExtensionContext,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
} from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { CreditsInfoError } from '../devtools-api';
import { CreditsInfo } from '../devtools-api/refactor-models';
import { logOutputChannel } from '../log';
import Telemetry from '../telemetry';
import { pluralize } from '../utils';
import { commonResourceRoots, getUri, nonce } from '../webview-utils';

export function registerControlCenterViewProvider(context: ExtensionContext) {
  const provider = new ControlCenterViewProvider();
  context.subscriptions.push(window.registerWebviewViewProvider('codescene.controlCenterView', provider));
  return provider;
}

export class ControlCenterViewProvider implements WebviewViewProvider, Disposable {
  private view?: WebviewView;
  private disposables: Disposable[] = [];

  constructor() {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: WebviewViewResolveContext,
    token: CancellationToken
  ): Thenable<void> | void {
    this.view = webviewView;
    const webView = this.view.webview;
    webView.options = {
      enableScripts: true,
      localResourceRoots: commonResourceRoots(),
    };

    webView.onDidReceiveMessage(this.handleMessages, this);
    this.handleVisibilityEvents(webviewView);

    this.update();
  }

  private handleVisibilityEvents(view: vscode.WebviewView) {
    view.onDidChangeVisibility(
      // On subsequent visibility changes (void event - use view.visible)
      () => Telemetry.logUsage('control-center/visibility', { visible: view.visible }),
      this,
      this.disposables
    );
  }

  // Just to be able to send visibility status on startup. Can't do that on resolveWebviewView since we don't know if DevtoolsAPI is available.
  public sendStartupTelemetry() {
    Telemetry.logUsage('control-center/visibility', { visible: this.view?.visible ? true : false });
  }

  private handleMessages(message: any) {
    const commands: { [key: string]: () => void } = {
      openAiPricing: () => this.openLink('https://codescene.com/product/ai-coding#pricing'),
      showLogOutput: () => logOutputChannel.show(),
      retryAce: () => {
        logOutputChannel.show();
        logOutputChannel.info('Retrying ACE activation...');
        void vscode.commands.executeCommand('codescene.ace.activate');
      },
      openSettings: () => {
        Telemetry.logUsage('control-center/open-settings');
        vscode.commands
          .executeCommand('workbench.action.openWorkspaceSettings', '@ext:codescene.codescene-vscode')
          .then(
            () => {},
            (err) => {
              logOutputChannel.info('Not inside a workspace, opening general/user settings instead.');
              void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codescene.codescene-vscode');
            }
          );
      },
      openDocumentation: () => this.openLink('https://codescene.io/docs'),
      openTermsAndPolicies: () => this.openLink('https://codescene.com/policies'),
      openAiPrivacyPrinciples: () => this.openLink('https://codescene.com/product/ace/principles'),
      openContactCodescene: () => this.openLink('https://codescene.com/company/contact-us'),
      raiseSupportTicket: () => this.openLink('https://supporthub.codescene.com/kb-tickets/new'),
    };

    const cmd = commands[message.command];

    if (!cmd) throw new Error(`Command not implemented: "${message.command}"!`);
    cmd.call(this);
  }

  private openLink(url: string) {
    Telemetry.logUsage('control-center/open-link', { url });
    void vscode.env.openExternal(vscode.Uri.parse(url));
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
    `;
  }

  private accountGroup() {
    return /*html*/ `
    <div class="group">
        <div class="header">ACCOUNT</div>
        <div class="row">
            <div class="icon-and-text clickable" id="upgrade-link"><span class="codicon codicon-star"></span><span>Upgrade</span></div>
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
    const { state, error } = CsExtensionState.stateProperties.features.analysis;
    let meta = { iconClass: '', text: '', badgeClass: '', error: '' };
    switch (state) {
      case 'loading':
        meta = { iconClass: 'codicon-loading codicon-modifier-spin', text: 'initializing', badgeClass: '', error: '' };
        break;
      case 'enabled':
        meta = { iconClass: 'codicon-pulse', text: 'activated', badgeClass: 'badge-activated', error: '' };
        break;
      case 'error':
        meta = {
          iconClass: 'codicon-error',
          text: state,
          badgeClass: 'badge-error',
          error: error ? error.message : '',
        };
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
    }" id="code-health-analysis-badge" title="${meta.error}">${meta.text}</div>
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
        tooltip = 'Click to retry connecting to CodeScene ACE';
        text = 'error';
        break;
    }

    // Custom presentation if we're out of credits
    if (aceFeature.error instanceof CreditsInfoError) {
      text = 'out of credits';
      outOfCreditsBanner = this.creditBannerContent(aceFeature.error.creditsInfo);
    }

    // Always in error if analysis error (fail to init or other error)
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

  private creditBannerContent(creditInfo: CreditsInfo) {
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
            <div class="icon-and-text clickable" id="privacy-principles"><span class="codicon codicon-shield"></span><span>AI Privacy Principles</span></div>
        </div>
        <div class="row">
            <div class="icon-and-text clickable" id="contact-codescene"><span class="codicon codicon-comment-discussion"></span><span>Contact CodeScene</span></div>
        </div>
        <div class="row">
            <div class="icon-and-text clickable" id="support-ticket-link"><span class="codicon codicon-feedback"></span><span>Raise a support ticket</span></div>
        </div>
    </div>  
    `;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
