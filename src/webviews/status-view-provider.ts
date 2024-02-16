import vscode, {
  CancellationToken,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
} from 'vscode';
import { nonce } from './utils';
import { CsExtensionState } from '../workspace';
import { PreFlightResponse } from '../cs-rest-api';
import { isDefined } from '../utils';
import { toDistinctLanguageIds, toRefactoringDocumentSelector } from '../language-support';

export function registerStatusViewProvider(context: vscode.ExtensionContext, initialState: CsExtensionState) {
  const provider = new StatusViewProvider(context.extensionUri, initialState);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(StatusViewProvider.viewId, provider));
  return provider;
}

export class StatusViewProvider implements WebviewViewProvider {
  public static readonly viewId = 'codescene.statusView';

  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri, private readonly initialState: CsExtensionState) {}

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
        case 'sign-in':
          vscode.commands.executeCommand('codescene.signInWithCodeScene');
          return;
      }
    });
    this.update(this.initialState);
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webView.cspSource}; font-src ${
      webView.cspSource
    }; style-src 'unsafe-inline' ${webView.cspSource};">

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

  update(csExtensionState: CsExtensionState) {
    const { signedIn } = csExtensionState;
    if (!this.view) return;

    const webView: Webview = this.view.webview;
    if (!signedIn) {
      this.view.badge = { tooltip: 'Not signed in', value: 1 };
      webView.html = this.notSignedInContent(webView, csExtensionState);
      return;
    }

    this.view.badge = { tooltip: 'Signed in', value: 0 };
    webView.html = this.signedInContent(webView, csExtensionState);
  }

  private notSignedInContent(webView: Webview, csExtensionState: CsExtensionState) {
    const { features } = csExtensionState;
    const html = /*html*/ `
  <h2>Not signed in</h2>
  ${this.featuresContent(features)}
  
  <p>In order to fully utilize the CodeScene extension, you need to sign in to CodeScene. Sign in using 
  the accounts menu <span class="codicon codicon-account"></span>.
  <p></p>
  <p>If you're part of the beta program for ACE, the refactoring features will be available as soon as you sign in.</p>
      `;
    return this.getContent(webView, html);
  }

  private signedInContent(webView: Webview, csExtensionState: CsExtensionState) {
    const { features } = csExtensionState;

    let ccContent = '';
    if (csExtensionState.features.changeCoupling) {
      ccContent = /*html*/ `
        <h3>Change Coupling</h3>
        <p>Change coupling is enabled and available in the Explorer and Source Control views. If your workspace 
        is associated with a CodeScene project, you will see which files are often changed together in the 
        <em>Change Coupling</em> view.</p>
        <p><span class="codicon codicon-question"></span> <a href="https://codescene.io/docs/guides/technical/change-coupling.html">Documentation on codescene.io</a></p>
  `;
    }

    let aceContent = '';
    if (isDefined(csExtensionState.features.automatedCodeEngineering)) {
      const preflight = csExtensionState.features.automatedCodeEngineering;
      const languageIdList = toDistinctLanguageIds(preflight.supported)
        .map((langIds) => `<li>${langIds}</li>`)
        .join('\n');
      const codeSmellList = preflight['supported']['code-smells']
        .map((codeSmells) => `<li>${codeSmells}</li>`)
        .join('\n');

      aceContent = /*html*/ `
        <h3>Automated Code Engineering (ACE)</h3>
        <p>ACE is active and available in the Explorer view.</p>
        <p>
        Supported languages:
        <ul>${languageIdList}</ul>
        Supported code smells:
        <ul>${codeSmellList}</ul>
        Also, only functions under ${preflight['max-input-loc']} lines of code will be considered for refactoring.
        </p>
        <p><span class="codicon codicon-question"></span> <a href="https://codescene.io/docs/auto-refactor/index.html">Documentation on codescene.io</a></p>
`;
    }

    const html = /*html*/ `
  <h2>Signed in</h2>
  ${this.featuresContent(features)}
  ${aceContent}
  ${ccContent}
`;
    return this.getContent(webView, html);
  }

  private featuresContent(features: {
    codeHealthAnalysis?: boolean;
    automatedCodeEngineering?: PreFlightResponse;
    changeCoupling?: boolean;
  }) {
    const featureNames = {
      'Code health analysis': features.codeHealthAnalysis,
      'Change Coupling': features.changeCoupling,
      'Automated Code Engineering': features.automatedCodeEngineering,
    };

    let featureListItems = '';
    Object.entries(featureNames).forEach(([featureName, value]) => {
      const iconType = value ? 'pass' : 'error';
      const state = value ? 'activated' : 'inactive';
      featureListItems += /*html*/ `<li><span class="codicon codicon-${iconType}"></span> ${featureName} ${state}</li>`;
    });
    return /*html*/ `<ul class="features-list">${featureListItems}</ul>`;
  }

  private getUri(webView: Webview, ...pathSegments: string[]) {
    return webView.asWebviewUri(Uri.joinPath(this.extensionUri, ...pathSegments));
  }
}
