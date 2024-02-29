import vscode, {
  CancellationToken,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
} from 'vscode';
import { PreFlightResponse } from '../cs-rest-api';
import { toDistinctLanguageIds } from '../language-support';
import { isDefined } from '../utils';
import { CsExtensionState, CsFeatures } from '../workspace';
import { nonce } from './utils';

export function registerStatusViewProvider(context: vscode.ExtensionContext, initialState: CsExtensionState) {
  const provider = new StatusViewProvider(context.extensionUri, initialState);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(StatusViewProvider.viewId, provider));
  return provider;
}

export class StatusViewProvider implements WebviewViewProvider {
  public static readonly viewId = 'codescene.statusView';

  private extensionState: CsExtensionState;
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri, initialState: CsExtensionState) {
    this.extensionState = initialState;
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
          vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'codescene');
          return;
        case 'focus-explorer-ace-view':
          vscode.commands.executeCommand('codescene.explorerAutoRefactorView.focus');
          return;
      }
    });
    this.update(this.extensionState);
  }

  update(csExtensionState: CsExtensionState) {
    this.extensionState = csExtensionState;
    if (!this.view) return;

    const webView: Webview = this.view.webview;
    if (!this.extensionState.session) {
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

  private cliStatusContent(features: CsFeatures) {
    if (features.codeHealthAnalysis.cliPath) {
      return /*html*/ `
        <h3>Code Health Analysis</h3>
        <p>Live <a href="https://codescene.io/docs/terminology/codescene-terminology.html#code-health">Code Health</a> 
        Analysis is enabled. Code health metrics and issues are available as a CodeLenses and in the Problems panel.
        </p>
      `;
    }
    return /*html*/ `
      <h3><span class="codicon codicon-warning"></span> Extension error</h3>
      <p>There was an error when initiating the CodeScene CLI: ${features.codeHealthAnalysis.error}</p>
    `;
  }

  private aceContent(preflight?: PreFlightResponse) {
    let content = /*html*/ `<h3>Automated Code Engineering (ACE)</h3>`;
    if (isDefined(preflight)) {
      const languageIdList = toDistinctLanguageIds(preflight.supported)
        .map((langIds) => `<li>${langIds}</li>`)
        .join('\n');
      const codeSmellList = preflight['supported']['code-smells']
        .map((codeSmells) => `<li>${codeSmells}</li>`)
        .join('\n');

      content += /*html*/ `
        <p>The ACE <a href="" id="auto-refactor-link">Auto-refactor</a> view is active and available in the Explorer activity bar.</p>
        <p>
        Supported languages:
        <ul>${languageIdList}</ul>
        Supported code smells:
        <ul>${codeSmellList}</ul>
        Also, only functions under ${preflight['max-input-loc']} lines of code will be considered for refactoring.
        </p>
        <p><span class="codicon codicon-question"></span> <a href="https://codescene.io/docs/auto-refactor/index.html">Documentation on codescene.io</a><br/>
        <span class="codicon codicon-verified"></span> <a href="https://codescene.com/product/ace/principles">Privacy Principles for CodeScene AI Based Services</a></p>
      `;
    } else {
      content += /*html*/ `
        <p>If you're part of the preview release program for ACE, the refactoring features will be available as soon as you <strong>sign 
        in using the accounts menu <span class="codicon codicon-account"></span></strong></p>
        <p>The Auto-refactor capability is available by invitation for all paid CodeScene subscriptions. Sign up <a href="https://codescene.com/ai">here</a>
        to join the waiting list.</p>
        <p><span class="codicon codicon-question"></span> <a href="https://codescene.io/docs/auto-refactor/index.html">Documentation on codescene.io</a></p>
      `;
    }
    return content;
  }

  private extensionStatusContent() {
    const { session, features } = this.extensionState;
    const featureNames = {
      'Code health analysis': features.codeHealthAnalysis.cliPath,
      'Automated Code Engineering (ACE)': features.automatedCodeEngineering,
    };

    const signedInListItem = `<li><span class="codicon codicon-shield ${session ? 'codicon-active' : ''}"></span> ${
      session ? 'Signed in' : 'Not signed in'
    }</li>`;
    let featureListItems = '';
    Object.entries(featureNames).forEach(([featureName, value]) => {
      const iconType = value ? 'pass' : 'error';
      const state = value ? 'activated' : 'inactive';
      const colorClass = value ? 'active' : 'inactive';
      featureListItems += /*html*/ `<li><span class="codicon codicon-${iconType} codicon-${colorClass}"></span> ${featureName} ${state}</li>`;
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

      <hr>

      ${this.cliStatusContent(features)}
      ${this.aceContent(features.automatedCodeEngineering)}

    `;
  }

  private getUri(webView: Webview, ...pathSegments: string[]) {
    return webView.asWebviewUri(Uri.joinPath(this.extensionUri, ...pathSegments));
  }
}
