import vscode, {
  CancellationToken,
  Disposable,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
} from 'vscode';
import { getConfiguration } from '../configuration';
import { CsExtensionState, CsFeatures, CsStateProperties } from '../cs-extension-state';
import { DownloadError } from '../download';
import { toDistinctLanguageIds } from '../language-support';
import { logOutputChannel } from '../log';
import { PreFlightResponse } from '../refactoring/model';
import Telemetry from '../telemetry';
import { isDefined } from '../utils';
import { getUri, nonce } from '../webviews/utils';

export function registerStatusViewProvider(context: vscode.ExtensionContext) {
  const provider = new StatusViewProvider(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codescene.statusView', provider));
  return provider;
}

export class StatusViewProvider implements WebviewViewProvider, Disposable {
  private disposables: Disposable[] = [];
  private stateProperties: CsStateProperties;
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.stateProperties = {};
  }

  resolveWebviewView(
    webviewView: WebviewView,
    context: WebviewViewResolveContext<unknown>,
    token: CancellationToken
  ): void | Thenable<void> {
    this.view = webviewView;
    const webView = this.view.webview;

    // Log usage when the view is resolved and on each subsequent visibility change
    Telemetry.instance.logUsage('statusView/show');
    this.disposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          Telemetry.instance.logUsage('statusView/show');
        }
      })
    );

    webView.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(this.extensionUri, 'out'), Uri.joinPath(this.extensionUri, 'assets')],
    };

    webView.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'open-settings':
          void vscode.commands.executeCommand(
            'workbench.action.openWorkspaceSettings',
            '@ext:codescene.codescene-vscode'
          );
          return;
        case 'focus-code-health-monitor-view':
          void vscode.commands.executeCommand('codescene.codeHealthMonitorView.focus');
          return;
        case 'focus-problems-view':
          void vscode.commands.executeCommand('workbench.action.problems.focus');
          return;
        case 'clear-errors':
          CsExtensionState.clearErrors();
          logOutputChannel.clear();
          return;
        case 'show-codescene-log-output':
          logOutputChannel.show();
          return;
      }
    });
    this.update(this.stateProperties);
  }

  update(stateProperties: CsStateProperties) {
    this.stateProperties = stateProperties;
    if (!this.view) return;

    const webView: Webview = this.view.webview;
    if (!this.stateProperties.session) {
      this.view.badge = { tooltip: 'Not signed in', value: 1 };
    } else {
      this.view.badge = { tooltip: 'Signed in', value: 0 };
    }

    webView.html = this.getContent(webView, this.extensionStatusContent());
  }

  private getContent(webView: Webview, htmlContent: string) {
    const webviewScript = getUri(webView, this.extensionUri, 'out', 'status-view', 'webview-script.js');
    const statusViewStyle = getUri(webView, this.extensionUri, 'out', 'status-view', 'styles.css');
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
          <link href="${statusViewStyle}" nonce="${nonce()}" type="text/css" rel="stylesheet" />
      </head>

      <body>
          ${htmlContent}
          <script type="module" nonce="${nonce()}" src="${webviewScript}"></script>
      </body>

      </html>
    `;
  }

  private cliStatusContent(features?: CsFeatures) {
    if (typeof features?.codeHealthAnalysis === 'string') {
      return /*html*/ `
        <h3>Code Health Analysis</h3>
        <p>Live <a href="https://codescene.io/docs/terminology/codescene-terminology.html#code-health">Code Health</a> 
        Analysis is enabled. Code health metrics and issues are available as CodeLenses and in the 
        <a href="" id="problems-panel-link">Problems panel</a>.</p>
      `;
    }
    if (features?.codeHealthAnalysis instanceof Error) {
      let actionableMessage;
      if (features?.codeHealthAnalysis instanceof DownloadError) {
        const err = features.codeHealthAnalysis;
        actionableMessage = /*html*/ `<p>
          Please try to installing the CodeScene devtools binary manually using these steps:
          <ul>
            <li>Download the required version manually from <a href="${err.url}">here</a></li>
            <li>Unpack and move it to ${err.expectedCliPath}</li>
            <li>Ensure it is executable, then restart the extension</li>
          </ul>
        </p>`;
      }
      return /*html*/ `
      <h3><span class="codicon codicon-warning color-inactive"></span> Extension error</h3>
      <p>There was an error when initiating the CodeScene devtools binary: <code>${
        features.codeHealthAnalysis.message
      }</code></p>
      ${actionableMessage ? actionableMessage : ''}
    `;
    }

    return /*html*/ `
    <h3><vscode-progress-ring class="progress-ring"></vscode-progress-ring>Initializing CodeScene devtools binary</h3>
    <p>Ensuring we have the latest CodeScene devtools binary working on your system...</p>
    `;
  }

  private aceContent(preflight?: PreFlightResponse | Error | string) {
    let content = /*html*/ `<h3>Augmented Code Engineering (ACE)</h3>`;
    const aceInfo = /*html*/ `
      <p>If you're part of the preview release program for ACE, the refactoring features will be available as soon as you <strong>sign 
      in using the accounts menu <span class="codicon codicon-account"></span></strong></p>
      <p>The Auto-refactor capability is available by invitation for all paid CodeScene subscriptions. Sign up <a href="https://codescene.com/ai">here</a>
      to join the waiting list.</p>
      <p><span class="codicon codicon-question"></span> <a href="https://codescene.io/docs/auto-refactor/index.html">Documentation on codescene.io</a></p>
    `;

    if (!isDefined(preflight)) {
      content += aceInfo;
    } else if (typeof preflight === 'string') {
      content += /*html*/ `
        <p><strong>${preflight}</strong></p>
        ${aceInfo}
      `;
    } else if (preflight instanceof Error) {
      content += /*html*/ `
        <p><span class="codicon codicon-error color-inactive"></span> There was an error requesting ACE capabilities:
        <code class="preflight-error">${preflight.message}</code></p>
        ${this.checkLogsContent()}
        <p>If applicable, check for any network or authentication issues and then try reloading the extension.</p>
      `;
    } else {
      const languageIdList = toDistinctLanguageIds(preflight.supported['file-types'])
        .map((langIds) => `<li>${langIds}</li>`)
        .join('\n');
      const codeSmellList = preflight['supported']['code-smells']
        .map((codeSmells) => `<li>${codeSmells}</li>`)
        .join('\n');

      const aceAvailableText = getConfiguration('previewCodeHealthMonitoring')
        ? `<p>ACE capabilities are available via codelens documentation and from the <a href="" id="code-health-monitor-link">Code Health Monitor</a> panel.</p>`
        : `<p>ACE capabilities are available via codelens documentation.</p>`;

      content += /*html*/ `
        ${aceAvailableText}
        <p>
        Supported languages:
        <ul>${languageIdList}</ul>
        Supported code smells:
        <ul>${codeSmellList}</ul>
        Also, only functions under ${preflight['max-input-loc']} lines of code will be considered for refactoring (ignoring commented lines).
        </p>
        <p><span class="codicon codicon-question"></span> <a href="https://codescene.io/docs/auto-refactor/index.html">Documentation on codescene.io</a><br/>
        <span class="codicon codicon-verified"></span> <a href="https://codescene.com/product/ace/principles">Privacy Principles for CodeScene AI Based Services</a></p>
      `;
    }

    return content;
  }

  private extensionStatusContent() {
    const { session, features, serviceErrors } = this.stateProperties;

    const featureNames = {
      'Code health analysis': codeHealthAnalysisEnabled(features),
      'Augmented Code Engineering (ACE)': aceEnabled(features),
    };

    const signedInListItem = `<li><span class="codicon codicon-shield ${session ? 'color-active' : ''}"></span> ${
      session ? 'Signed in' : 'Not signed in'
    }</li>`;
    let featureListItems = '';
    Object.entries(featureNames).forEach(([featureName, value]) => {
      const iconType = value ? 'pass' : 'error';
      const state = value ? 'activated' : 'inactive';
      const colorClass = value ? 'active' : 'inactive';
      featureListItems += /*html*/ `<li><span class="codicon codicon-${iconType} color-${colorClass}"></span> ${featureName} ${state}</li>`;
    });

    return /*html*/ `
      <h2>CodeScene extension status</h2>
      <vscode-button id="open-settings-button" appearance="icon" aria-label="Extension settings" title="Extension settings">
        <span class="codicon codicon-settings-gear"></span>
      </vscode-button>
      <ul class="features-list">
        ${signedInListItem}
        ${featureListItems}
      </ul>

      ${serviceErrors ? this.errorContent(serviceErrors) : ''}

      <hr>

      ${this.cliStatusContent(features)}
      <!-- Don't show the ace info while cli is initializating -->
      ${features?.codeHealthAnalysis ? this.aceContent(features.ace) : ''}
    `;
  }

  private errorContent(serviceErrors: any[]) {
    return /*html*/ `
      <hr>
      <h3><span class="codicon codicon-warning color-warning"></span> Errors</h3>
      <p>The CodeScene extension has encountered an error.</p>
      ${this.checkLogsContent()}
      <vscode-button id="clear-errors-button" aria-label="Clear errors" 
      title="Ignore and continue using the CodeScene extension">
        Clear errors
      </vscode-button>
    `;
  }

  private checkLogsContent() {
    return /*html*/ `
    <p>Please check <a href="" id="show-codescene-log-link">the logs</a> for details, and include any details if 
    opening a support issue.</p>  
  `;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

export function codeHealthAnalysisEnabled(features?: CsFeatures) {
  return isDefined(features?.codeHealthAnalysis) && !(features?.codeHealthAnalysis instanceof Error);
}

export function aceEnabled(features?: CsFeatures) {
  return isDefined(features?.ace) && typeof features?.ace !== 'string' && !(features?.ace instanceof Error);
}
