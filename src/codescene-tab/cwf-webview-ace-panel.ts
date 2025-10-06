import vscode, { Disposable, ViewColumn, WebviewPanel } from 'vscode';
import { MessageToIDEType } from '../centralized-webview-framework/types/messages';
import { InteractiveDocsParams } from '../documentation/commands';
import { showDocAtPosition } from '../utils';
import { commonResourceRoots } from '../webview-utils';

export class CodeSceneCWFAceTabPanel implements Disposable {
  private static _instance: CodeSceneCWFAceTabPanel | undefined;
  private static readonly viewType = 'codescene-tab';
  private readonly webViewPanel: WebviewPanel;
  private disposables: Disposable[] = [];
  private state?: InteractiveDocsParams;
  private initialized: boolean = false;

  public static get instance() {
    if (!CodeSceneCWFAceTabPanel._instance) {
      CodeSceneCWFAceTabPanel._instance = new CodeSceneCWFAceTabPanel();
    }
    return CodeSceneCWFAceTabPanel._instance;
  }

  constructor() {
    this.webViewPanel = vscode.window.createWebviewPanel(
      CodeSceneCWFAceTabPanel.viewType,
      'CodeScene',
      { viewColumn: ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: commonResourceRoots(),
      }
    );
    this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webViewPanel.webview.onDidReceiveMessage(this.handleMessages, this, this.disposables);

    vscode.workspace.onDidCloseTextDocument(
      (e) => {
        const closedThisDoc = this.state?.document === e;
        if (closedThisDoc) this.dispose();
      },
      this,
      this.disposables
    );
  }

  private async handleMessages(message: MessageToIDEType) {
    try {
      if (!this.state) return;
      await this.handleDocumentationMessage(this.state, message);
    } catch (e) {
      reportError({ context: 'CodeScene tab message handling', e });
    }
  }

  private async handleDocumentationMessage(params: InteractiveDocsParams, message: MessageToIDEType) {
    switch (message.messageType) {
      case 'init':
        this.initialized = true;
        return;
      case 'goto-function-location':
        void showDocAtPosition(params.document, params.issueInfo.position);
        return;
      default:
        throw new Error(`Command not implemented: "${message.messageType}"!`);
    }
  }

  // RENDERING
  // Webview is visible and initiated
  private isActive() {
    return CodeSceneCWFAceTabPanel.instance.webViewPanel.visible && this.initialized;
  }

  // Render webview either by creatign html or sending update-renderer message
  private async updateWebView(params: InteractiveDocsParams) {
    // this.state = params;
    // const { issueInfo, document } = params;
    // const fileData = getFileData(params);
    // if (this.isActive()) {
    //   await this.webViewPanel.webview.postMessage({
    //     messageType: 'update-renderer',
    //     payload: getDocsData(issueInfo.category, fileData),
    //   });
    // } else {
    //   const htmlContent = initBaseContent(this.webViewPanel.webview, getDocsData(issueInfo.category, fileData));
    //   this.webViewPanel.webview.html = htmlContent;
    // }
  }

  dispose() {
    CodeSceneCWFAceTabPanel._instance = undefined;
    this.webViewPanel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  static show(params: InteractiveDocsParams) {
    void CodeSceneCWFAceTabPanel.instance.updateWebView(params);
    if (!CodeSceneCWFAceTabPanel.instance.webViewPanel.visible) {
      CodeSceneCWFAceTabPanel.instance.webViewPanel.reveal(undefined, true);
    }
  }
}
