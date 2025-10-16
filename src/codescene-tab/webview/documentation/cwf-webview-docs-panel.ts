import vscode, { Disposable, ViewColumn, WebviewPanel } from 'vscode';
import { InteractiveDocsParams } from '../../../documentation/commands';
import { reportError, showDocAtPosition } from '../../../utils';
import { commonResourceRoots } from '../../../webview-utils';
import { MessageToIDEType } from '../../../centralized-webview-framework/types/messages';
import { initBaseContent } from '../../../centralized-webview-framework/cwf-html-utils';
import { getDocsData, getFileData } from './docs-data-mapper';
import { FileMetaType } from '../../../centralized-webview-framework/types';
import Telemetry from '../../../telemetry';

type CodeSceneTabPanelState = InteractiveDocsParams & {
  isStale?: boolean;
  fileData: FileMetaType;
};

export class CodeSceneCWFDocsTabPanel implements Disposable {
  private static _instance: CodeSceneCWFDocsTabPanel | undefined;
  private static readonly viewType = 'codescene-docs-tab';
  private readonly webViewPanel: WebviewPanel;
  private disposables: Disposable[] = [];
  private state?: CodeSceneTabPanelState;
  private initialized: boolean = false;

  public static get instance() {
    if (!CodeSceneCWFDocsTabPanel._instance) {
      CodeSceneCWFDocsTabPanel._instance = new CodeSceneCWFDocsTabPanel();
    }
    return CodeSceneCWFDocsTabPanel._instance;
  }

  constructor() {
    this.webViewPanel = vscode.window.createWebviewPanel(
      CodeSceneCWFDocsTabPanel.viewType,
      'Code smell documentation',
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

  // MESSAGES
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
        if (message.payload === 'docs') {
          this.initialized = true;

          // Refresh to latest data when tab is visible again to render correct data
          const { issueInfo, fileData } = this.state as CodeSceneTabPanelState;
          await this.webViewPanel.webview.postMessage({
            messageType: 'update-renderer',
            payload: getDocsData(issueInfo.category, fileData),
          });
        }
        return;
      case 'open-settings':
        Telemetry.logUsage('control-center/open-settings');
        vscode.commands
          .executeCommand('workbench.action.openWorkspaceSettings', '@ext:codescene.codescene-vscode')
          .then(
            () => {},
            (err) => {
              void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codescene.codescene-vscode');
            }
          );
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
    return CodeSceneCWFDocsTabPanel.instance.webViewPanel.visible && this.initialized;
  }

  // Render webview either by creating html or sending update-renderer message
  private async updateWebView(params: InteractiveDocsParams) {
    const { issueInfo } = params;
    const fileData = getFileData(params);

    this.state = { ...params, fileData };

    if (this.isActive()) {
      await this.webViewPanel.webview.postMessage({
        messageType: 'update-renderer',
        payload: getDocsData(issueInfo.category, fileData),
      });
    } else {
      const htmlContent = initBaseContent(this.webViewPanel.webview, getDocsData(issueInfo.category, fileData));
      this.webViewPanel.webview.html = htmlContent;
    }
  }

  dispose() {
    CodeSceneCWFDocsTabPanel._instance = undefined;
    this.initialized = false;

    this.webViewPanel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  static show(params: InteractiveDocsParams) {
    void CodeSceneCWFDocsTabPanel.instance.updateWebView(params);
    if (!CodeSceneCWFDocsTabPanel.instance.webViewPanel.visible) {
      CodeSceneCWFDocsTabPanel.instance.webViewPanel.reveal(undefined, true);
    }
  }
}
