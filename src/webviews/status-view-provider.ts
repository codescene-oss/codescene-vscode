import vscode, {
  CancellationToken,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
} from 'vscode';
import { CsExtensionState, CsFeatures, CsStateProperties } from '../cs-extension-state';
import { toDistinctLanguageIds } from '../language-support';
import { logOutputChannel } from '../log';
import { PreFlightResponse } from '../refactoring/model';
import { isDefined } from '../utils';
import { nonce } from './utils';

export function registerStatusViewProvider(context: vscode.ExtensionContext) {
  const provider = new StatusViewProvider(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(StatusViewProvider.viewId, provider));
  return provider;
}

export class StatusViewProvider implements WebviewViewProvider {
  public static readonly viewId = 'codescene.statusView';

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

    webView.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(this.extensionUri, 'out'), Uri.joinPath(this.extensionUri, 'assets')],
    };

    webView.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'open-settings':
          void vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'codescene');
          return;
        case 'focus-code-health-gate-view':
          void vscode.commands.executeCommand('codescene.codeHealthGateView.focus');
          return;
        case 'focus-problems-view':
          void vscode.commands.executeCommand('workbench.action.problems.focus');
          return;
        case 'focus-explorer-code-health-view':
          void vscode.commands.executeCommand('codescene.explorerCodeReviewView.focus');
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
    const webviewScript = this.getUri(webView, 'out', 'webviews', 'status-webview-script.js');
    const statusViewStyle = this.getUri(webView, 'assets', 'status-view.css');
    const codiconsUri = this.getUri(webView, 'out', 'codicons', 'codicon.css');

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
        Analysis is enabled. Code health metrics and issues are available as a CodeLense and in the 
        <a href="" id="problems-panel-link">Problems panel</a>. Analysed files are also available in the 
        <a href="" id="explorer-code-health-link">Code Health view</a>, if it's enabled.</p>
      `;
    }
    if (features?.codeHealthAnalysis instanceof Error) {
      return /*html*/ `
      <h3><span class="codicon codicon-warning color-inactive"></span> Extension error</h3>
      <p>There was an error when initiating the CodeScene CLI: ${features.codeHealthAnalysis.message}</p>
    `;
    }

    return /*html*/ `
    <h3><vscode-progress-ring class="progress-ring"></vscode-progress-ring>Initializing CodeScene CLI</h3>
    <p>Ensuring we have the latest CodeScene CLI version working on your system...</p>
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

      content += /*html*/ `
      <p>ACE capabilities are available from the <a href="" id="code-health-gate-link">Code Quality Gate</a> view.</p>
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

  private getUri(webView: Webview, ...pathSegments: string[]) {
    return webView.asWebviewUri(Uri.joinPath(this.extensionUri, ...pathSegments));
  }
}

export function codeHealthAnalysisEnabled(features?: CsFeatures) {
  return isDefined(features?.codeHealthAnalysis) && !(features?.codeHealthAnalysis instanceof Error);
}

export function aceEnabled(features?: CsFeatures) {
  return isDefined(features?.ace) && typeof features?.ace !== 'string' && !(features?.ace instanceof Error);
}
