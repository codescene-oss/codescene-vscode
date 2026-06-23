import vscode, {
  CancellationToken,
  Disposable,
  ExtensionContext,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
} from 'vscode';
import { getConfiguration } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { DevtoolsAPI } from '../devtools-api';
import { logOutputChannel } from '../log';
import { getExtensionSettingsFilter } from '../extension-id';
import Telemetry from '../telemetry';
import { commonResourceRoots, getUri, nonce } from '../webview-utils';

export function registerControlCenterViewProvider(context: ExtensionContext) {
  const provider = new ControlCenterViewProvider();
  context.subscriptions.push(window.registerWebviewViewProvider('codescene.controlCenterView', provider));
  return provider;
}

export class ControlCenterViewProvider implements WebviewViewProvider, Disposable {
  private view?: WebviewView;
  private disposables: Disposable[] = [];
  private deviceId?: string;

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

  /**
   * Call this when DevtoolsAPI is guaranteed to be initialized
   * Will send visibility status for the control-center as well as fetching the device-id from the API
   */
  public async activationFinalized() {
    Telemetry.logUsage('control-center/visibility', { visible: this.view?.visible ? true : false });
    if (getConfiguration('enableTelemetry')) {
      this.deviceId = await DevtoolsAPI.getDeviceId();
    }
  }

  private handleMessages(message: any) {
    const commands: { [key: string]: () => void } = {
      openAiPricing: () => this.openLink('https://codescene.com/product/ai-coding#pricing'),
      showLogOutput: () => logOutputChannel.show(),
      openSettings: () => {
        Telemetry.logUsage('control-center/open-settings');
        vscode.commands
          .executeCommand('workbench.action.openWorkspaceSettings', getExtensionSettingsFilter())
          .then(
            () => {},
            (err) => {
              logOutputChannel.info('Not inside a workspace, opening general/user settings instead.');
              void vscode.commands.executeCommand('workbench.action.openSettings', getExtensionSettingsFilter());
            }
          );
      },
      openDocumentation: () => this.openLink('https://codescene.io/docs'),
      openTermsAndPolicies: () => this.openLink('https://codescene.com/policies'),
      openAiPrivacyPrinciples: () => this.openLink('https://codescene.com/product/ace/principles'),
      openContactCodescene: () => this.openLink('https://codescene.com/company/contact-us'),
      raiseSupportTicket: () => this.openLink('https://supporthub.codescene.com/kb-tickets/new'),
      copyDeviceId: () => {
        if (!this.deviceId) return;
        void vscode.env.clipboard.writeText(this.deviceId).then(() => {
          void vscode.window.showInformationMessage('Copied device-id to clipboard.');
        });
      },
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
        ${this.deviceIdDiv()}
    `;
  }

  private deviceIdDiv() {
    return this.deviceId
      ? `<div class="clickable" id="device-id" title="Click to copy">device-id: ${this.deviceId}</div>`
      : '';
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
    return /*html*/ `
        <div class="row">
            <div class="icon-and-text"><span class="codicon codicon-circle-slash"></span><span>CodeScene Refactoring Agent</span></div>
            <div class="badge badge-deactivated">deactivated</div>
        </div>
    `;
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
