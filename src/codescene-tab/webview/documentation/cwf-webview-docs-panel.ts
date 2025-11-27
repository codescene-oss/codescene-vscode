import vscode, { Disposable, ViewColumn, WebviewPanel } from 'vscode';
import { InteractiveDocsParams } from '../../../documentation/commands';
import { reportError, showDocAtPosition } from '../../../utils';
import { commonResourceRoots } from '../../../webview-utils';
import { MessageToIDEType } from '../../../centralized-webview-framework/types/messages';
import { initBaseContent } from '../../../centralized-webview-framework/cwf-html-utils';
import { getDocsData } from './docs-data-mapper';
import Telemetry from '../../../telemetry';
import { CsExtensionState } from '../../../cs-extension-state';
import { onDidChangeConfiguration } from '../../../configuration';

export type CodeSceneTabPanelState = InteractiveDocsParams & {
  isStale?: boolean;
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
      'CodeScene documentation',
      { viewColumn: ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: commonResourceRoots(),
      }
    );
    this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webViewPanel.webview.onDidReceiveMessage(this.handleMessages, this, this.disposables);

    this.disposables.push(
      this,
      CsExtensionState.onAceStateChanged(() => this.refreshAceState()), // Detect change to ACE status
      onDidChangeConfiguration('authToken', () => this.refreshAceState()) // Detect change to ACE auth token in settings
    );
    vscode.workspace.onDidCloseTextDocument(
      (e) => {
        const closedThisDoc = this.state?.document === e;
        if (closedThisDoc) this.webViewPanel.dispose();
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
      reportError({ context: 'An error occurred in the CodeScene Docs panel', e });
    }
  }

  private async refreshAceState() {
    if (this.state) {
      await this.webViewPanel.webview.postMessage({
        messageType: 'update-renderer',
        payload: await getDocsData(this.state),
      });
    }
  }

  private async handleDocumentationMessage(params: InteractiveDocsParams, message: MessageToIDEType) {
    const handlers: Record<string, () => Promise<void> | void> = {
      init: async () => {
        if (message.messageType === 'init' && message.payload === 'docs') {
          this.initialized = true;

          // Refresh to latest data when tab is visible again to render correct data
          if (this.state) {
            await this.webViewPanel.webview.postMessage({
              messageType: 'update-renderer',
              payload: await getDocsData(this.state),
            });
          }
        }
      },
      'open-settings': async () => {
        Telemetry.logUsage('control-center/open-settings');
        try {
          await vscode.commands.executeCommand(
            'workbench.action.openWorkspaceSettings',
            '@ext:codescene.codescene-vscode'
          );
        } catch {
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codescene.codescene-vscode');
        }
      },
      'goto-function-location': () => {
        void showDocAtPosition(params.document, params.issueInfo.position);
      },

      acknowledged: async () => {
        await CsExtensionState.setAcknowledgedAceUsage(true);
        void vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          params.document,
          'interactive-docs',
          params.fnToRefactor,
          false, // Never skip cache
          params.codeSmell
        );
        this.webViewPanel.dispose();
      },
      'request-and-present-refactoring': () => {
        void vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          params.document,
          'interactive-docs',
          params.fnToRefactor,
          false, // Never skip cache
          params.codeSmell
        );
        this.webViewPanel.dispose();
      },
    };

    const handler = handlers[message.messageType];
    if (!handler) {
      throw new Error(`Command not implemented: "${message.messageType}"!`);
    }

    await handler();
  }

  // RENDERING
  // Webview is visible and initiated
  private isActive() {
    return CodeSceneCWFDocsTabPanel.instance.webViewPanel.visible && this.initialized;
  }

  // Render webview either by creating html or sending update-renderer message
  private async updateWebView(params: InteractiveDocsParams) {
    this.state = { ...params };

    if (this.isActive()) {
      await this.webViewPanel.webview.postMessage({
        messageType: 'update-renderer',
        payload: await getDocsData(this.state),
      });
    } else {
      const docsData = await getDocsData(this.state);
      const htmlContent = initBaseContent(this.webViewPanel.webview, docsData);
      this.webViewPanel.webview.html = htmlContent;
    }
  }

  dispose() {
    CodeSceneCWFDocsTabPanel._instance = undefined;
    this.state = undefined;
    this.initialized = false;

    this.disposables.forEach((d) => d.dispose());
  }

  static show(params: InteractiveDocsParams) {
    void CodeSceneCWFDocsTabPanel.instance.updateWebView(params);
    if (!CodeSceneCWFDocsTabPanel.instance.webViewPanel.visible) {
      CodeSceneCWFDocsTabPanel.instance.webViewPanel.reveal(undefined, true);
    }
  }
}
