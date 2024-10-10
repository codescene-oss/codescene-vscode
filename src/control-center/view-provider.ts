import vscode, {
  CancellationToken,
  ExtensionContext,
  Uri,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
} from 'vscode';
import { getUri, nonce } from '../webviews/utils';
import { CsFeatures, CsStateProperties } from '../cs-extension-state';
import { DownloadError } from '../download';
import { isDefined } from '../utils';
import { getConfiguration } from '../configuration';

export function registerControlCenterViewProvider(context: ExtensionContext) {
  const provider = new ControlCenterViewProvider(context.extensionUri);
  context.subscriptions.push(window.registerWebviewViewProvider('codescene.controlCenterView', provider));
  return provider;
}

export class ControlCenterViewProvider implements WebviewViewProvider /* , Disposable */ {
  private view?: WebviewView;
  private stateProperties: CsStateProperties = {};

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

    this.update(this.stateProperties);
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
        void vscode.commands.executeCommand('codescene.showLogOutput');
        return;
      case 'open-documentation':
        void vscode.env.openExternal(vscode.Uri.parse('https://codescene.io/docs'));
        return;
      case 'open-privacy-principles':
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

  update(stateProperties: CsStateProperties) {
    this.stateProperties = stateProperties;
    if (!this.view) {
      return;
    }

    const webView = this.view.webview;
    webView.html = this.wrapWithBoilerplate(webView, this.getContent());
  }

  private wrapWithBoilerplate(webView: vscode.Webview, bodyContent?: string) {
    const webviewScript = getUri(webView, this.extensionUri, 'out', 'control-center', 'webview-script.js');
    const stylesUri = getUri(webView, this.extensionUri, 'out', 'control-center', 'styles.css');
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
          <link href="${stylesUri}" nonce="${nonce()}" type="text/css" rel="stylesheet" />
      </head>

      <body>
          ${bodyContent ? bodyContent : ''}
          <script type="module" nonce="${nonce()}" src="${webviewScript}"></script>
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
            <div class="icon-and-text"><span class="codicon codicon-verified"></span><span>ACE Credits</span></div>
            <div class="badge badge-activated">available</div>
        </div>
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
        ${this.codeHealthStatusRow()}
        ${this.aceStatusRow()}
    </div>  
    `;
  }

  private codeHealthStatusRow() {
    const features = this.stateProperties.features;

    let meta = { iconClass: 'codicon-loading codicon-modifier-spin', text: 'initializing', badgeClass: '' };
    if (typeof features?.codeHealthAnalysis === 'string') {
      meta = { iconClass: 'codicon-pulse', text: 'activated', badgeClass: 'badge-activated' };
    } else if (features?.codeHealthAnalysis instanceof Error) {
      if (features?.codeHealthAnalysis instanceof DownloadError) {
        const err = features.codeHealthAnalysis;
        const actionableMessage = /*html*/ `<p>
        Please try to installing the CodeScene devtools binary manually using these steps:
        <ul>
          <li>Download the required version manually from <a href="${err.url}">here</a></li>
          <li>Unpack and move it to ${err.expectedCliPath}</li>
          <li>Ensure it is executable, then restart the extension</li>
        </ul>
      </p>`;
      }
      meta = { iconClass: 'codicon-error', text: 'error', badgeClass: 'badge-error' };
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
    const features = this.stateProperties.features;
    const preflight = features?.ace;

    let meta = { iconClass: 'codicon-loading codicon-modifier-spin', text: 'initializing', badgeClass: '' };
    if (features?.codeHealthAnalysis instanceof Error) {
      meta = { iconClass: 'codicon-error', text: 'error', badgeClass: 'badge-error' };
    }
    if (!getConfiguration('enableAutoRefactor')) {
      meta = { iconClass: 'codicon-loading codicon-disabled', text: 'deactivated', badgeClass: '' };
    }
    if (isDefined(preflight)) {
      if (preflight instanceof Error) {
        meta = { iconClass: 'codicon-error', text: 'error', badgeClass: 'badge-error' };
      } else if (typeof preflight === 'string') {
      } else {
        meta = { iconClass: 'codicon-sparkle', text: 'activated', badgeClass: 'badge-activated' };
      }
    }

    return /*html*/ `
        <div class="row">
            <div class="icon-and-text"><span class="codicon ${meta.iconClass}"></span><span>CodeScene ACE</span></div>
            <div class="badge badge-${meta.text} ${meta.text === 'error' ? 'clickable' : ''}" id="ace-badge">${
      meta.text
    }</div>
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
            <div class="icon-and-text clickable" id="privacy-principles"><span class="codicon codicon-file"></span><span>Privacy Principles</span></div>
        </div>
        <div class="row">
            <div class="icon-and-text clickable" id="contact-codescene"><span class="codicon codicon-comment-discussion"></span><span>Contact CodeScene</span></div>
        </div>
    </div>  
    `;
  }
}

export function codeHealthAnalysisEnabled(features?: CsFeatures) {
  return isDefined(features?.codeHealthAnalysis) && !(features?.codeHealthAnalysis instanceof Error);
}

export function aceEnabled(features?: CsFeatures) {
  return isDefined(features?.ace) && typeof features?.ace !== 'string' && !(features?.ace instanceof Error);
}
