import vscode, { Disposable, ViewColumn, WebviewPanel } from 'vscode';
import { initBaseContent } from '../../../../centralized-webview-framework/cwf-html-utils';
import { AceAcknowledgeContextViewProps } from '../../../../centralized-webview-framework/types';
import { MessageToIDEType } from '../../../../centralized-webview-framework/types/messages';
import { logOutputChannel } from '../../../../log';
import { RefactoringRequest } from '../../../../refactoring/request';
import { highlightCode } from '../../../../refactoring/utils';
import Telemetry from '../../../../telemetry';
import { showDocAtPosition } from '../../../../utils';
import { commonResourceRoots } from '../../../../webview-utils';
import { CsExtensionState } from '../../../../cs-extension-state';
import { getAceAcknowledgeData } from './ace-acknowledgement-mapper';

export interface CwfAceAcknowledgementTabParams {
  request: RefactoringRequest;
  cwfProps?: AceAcknowledgeContextViewProps;
}

export class CodeSceneCWFAceAcknowledgementTabPanel implements Disposable {
  private static _instance: CodeSceneCWFAceAcknowledgementTabPanel | undefined;
  private static readonly viewType = 'codescene-ace-acknowledgement-tab';
  private readonly webViewPanel: WebviewPanel;

  private disposables: Disposable[] = [];
  private state?: CwfAceAcknowledgementTabParams;
  private initialized: boolean = false;

  public static get instance() {
    if (!CodeSceneCWFAceAcknowledgementTabPanel._instance) {
      CodeSceneCWFAceAcknowledgementTabPanel._instance = new CodeSceneCWFAceAcknowledgementTabPanel();
    }
    return CodeSceneCWFAceAcknowledgementTabPanel._instance;
  }

  constructor() {
    this.webViewPanel = vscode.window.createWebviewPanel(
      CodeSceneCWFAceAcknowledgementTabPanel.viewType,
      'CodeScene ACE - AI-Powered Refactoring',
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
        const closedThisDoc = this.state?.request.document === e;
        if (closedThisDoc) this.dispose();
      },
      this,
      this.disposables
    );
  }

  private async handleMessages(message: MessageToIDEType) {
    try {
      if (!this.state) return;
      await this.handleMessage(this.state.request, message);
    } catch (e) {
      reportError({ context: 'CodeScene tab message handling', e });
    }
  }

  private async handleMessage(request: RefactoringRequest, message: MessageToIDEType) {
    const handlers: Record<string, () => void> = {
      init: () => this.handleInit(message),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'goto-function-location': async () => {
        await showDocAtPosition(request.document, request.fnToRefactor.vscodeRange.start);
        void highlightCode(request, false);
      },
      acknowledged: async () => {
        const document = this.state?.request.document;
        const fnToRefactor = this.state?.request.fnToRefactor;

        this.dispose();

        await CsExtensionState.setAcknowledgedAceUsage(true);
        Telemetry.logUsage('ace-info/acknowledged');

        void vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          document,
          'ace-acknowledgement',
          fnToRefactor
        );
        return;
      },
    };

    const handler = handlers[message.messageType];
    if (!handler) {
      logOutputChannel.error(
        `Unable to handle ACE acknowledgement message: Command not available: "${message.messageType}".`
      );
      return;
    }

    handler();
  }

  private handleInit(message: MessageToIDEType) {
    const aceMessage = message.messageType === 'init' && message.payload === 'aceAcknowledge';
    if (!aceMessage) return;

    this.initialized = true;

    const { cwfProps: aceData, request } = this.state as CwfAceAcknowledgementTabParams;
    if (aceData) void this.renderAce(request, aceData);
  }

  private isActive() {
    return this.initialized;
  }

  private async updateWebView(request: RefactoringRequest) {
    const data = getAceAcknowledgeData(request);
    await this.renderAce(request, data);
  }

  private async renderAce(request: RefactoringRequest, data: AceAcknowledgeContextViewProps) {
    this.state = { request, cwfProps: data };

    const message = {
      messageType: 'update-renderer',
      payload: data,
    };

    if (this.isActive()) {
      await this.webViewPanel.webview.postMessage(message);
    } else {
      const htmlContent = initBaseContent(this.webViewPanel.webview, data);
      this.webViewPanel.webview.html = htmlContent;
    }
  }

  dispose() {
    CodeSceneCWFAceAcknowledgementTabPanel._instance = undefined;

    this.state = undefined;
    this.initialized = false;

    this.webViewPanel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  static show(request: RefactoringRequest) {
    void CodeSceneCWFAceAcknowledgementTabPanel.instance.updateWebView(request);

    if (!CodeSceneCWFAceAcknowledgementTabPanel.instance.webViewPanel.visible) {
      CodeSceneCWFAceAcknowledgementTabPanel.instance.webViewPanel.reveal(undefined, true);
    }
  }
}
