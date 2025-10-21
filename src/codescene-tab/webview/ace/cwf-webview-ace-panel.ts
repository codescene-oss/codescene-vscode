import vscode, { Disposable, ViewColumn, WebviewPanel } from 'vscode';
import { MessageToIDEType } from '../../../centralized-webview-framework/types/messages';
import { showDocAtPosition } from '../../../utils';
import { commonResourceRoots } from '../../../webview-utils';
import Telemetry from '../../../telemetry';
import {
  copyCode,
  deselectRefactoring,
  highlightCode,
  isFunctionUnchangedInDocument,
} from '../../../refactoring/utils';
import { logOutputChannel } from '../../../log';
import { RefactoringRequest } from '../../../refactoring/request';
import { initBaseContent } from '../../../centralized-webview-framework/cwf-html-utils';
import { AceContextViewProps } from '../../../centralized-webview-framework/types';
import { getAceData } from './ace-data-mapper';
import debounce from 'lodash.debounce';
import { logIdString } from '../../../devtools-api';

export interface CwfAceTabParams {
  request: RefactoringRequest;
  cwfProps?: AceContextViewProps;
  isStale?: boolean;
}

export class CodeSceneCWFAceTabPanel implements Disposable {
  private messageQueue: { messageType: string; payload: any }[] = [];
  private hasSetInitialScript = false;

  private static _instance: CodeSceneCWFAceTabPanel | undefined;
  private static readonly viewType = 'codescene-ace-tab';
  private readonly webViewPanel: WebviewPanel;
  private disposables: Disposable[] = [];
  private state?: CwfAceTabParams;
  private initialized: boolean = false;
  private debouncedUpdateWebView: (request: RefactoringRequest) => void;

  public static get instance() {
    if (!CodeSceneCWFAceTabPanel._instance) {
      CodeSceneCWFAceTabPanel._instance = new CodeSceneCWFAceTabPanel();
    }
    return CodeSceneCWFAceTabPanel._instance;
  }

  constructor() {
    this.debouncedUpdateWebView = debounce((request) => this.updateWebView(request), 1000);

    this.webViewPanel = vscode.window.createWebviewPanel(
      CodeSceneCWFAceTabPanel.viewType,
      'CodeScene ACE',
      { viewColumn: ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: commonResourceRoots(),
      }
    );

    this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webViewPanel.webview.onDidReceiveMessage(this.handleMessages, this, this.disposables);

    vscode.workspace.onDidChangeTextDocument((e) => this.handleIsStale(e), this, this.disposables);

    vscode.workspace.onDidCloseTextDocument(
      (e) => {
        const closedThisDoc = this.state?.request.document === e;
        if (closedThisDoc) this.dispose();
      },
      this,
      this.disposables
    );
  }

  private handleIsStale(e: vscode.TextDocumentChangeEvent) {
    if (!this.state) return;
    const { document, fnToRefactor } = this.state.request;
    if (document !== e.document || e.contentChanges.length === 0) return;
    const { shouldUpdateRange, isStale } = isFunctionUnchangedInDocument(document, fnToRefactor);

    // (cast this.state.isStale to boolean to avoid a first glitch when changing state from undefined to false)
    const stalenessChanged = isStale !== !!this.state.isStale;

    if (stalenessChanged) this.state.isStale = isStale;
    if (stalenessChanged || shouldUpdateRange) this.debouncedUpdateWebView(this.state.request);
  }

  private async handleMessages(message: MessageToIDEType) {
    try {
      if (!this.state) return;
      await this.handleAceMessage(this.state.request, message);
    } catch (e) {
      reportError({ context: 'CodeScene tab message handling', e });
    }
  }

  private async handleAceMessage(request: RefactoringRequest, message: MessageToIDEType) {
    const handlers: Record<string, () => void> = {
      init: () => this.handleInit(message),
      apply: async () => {
        try {
          await vscode.commands.executeCommand('codescene.applyRefactoring', request);
          this.dispose();
        } catch (e) {
          reportError({ context: 'Error applying refactoring', e });
          this.dispose();
        }
      },
      reject: () => {
        deselectRefactoring(request);
        Telemetry.logUsage('refactor/rejected', request.eventData);
        this.dispose();
      },
      close: () => {
        this.dispose();
        return;
      },
      retry: async () => {
        await vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          request.document,
          'retry',
          request.fnToRefactor,
          true
        );
      },
      showDiff: () => {
        void vscode.commands.executeCommand('codescene.showDiffForRefactoring', request);
      },
      copyCode: async () => {
        Telemetry.logUsage('refactor/copy-code', request.eventData);
        await copyCode(request);
      },
      showLogoutput: () => {
        logOutputChannel.show();
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'goto-function-location': async () => {
        await showDocAtPosition(request.document, request.fnToRefactor.vscodeRange.start);
        void highlightCode(request, false);
      },
      cancel: () => {
        request.abort();
        this.dispose();

        logOutputChannel.info(
          `Refactor request aborted ${logIdString(request.fnToRefactor, request.traceId)}${
            request.skipCache === true ? ' (retry)' : ''
          }`
        );
        return;
      },
    };

    const handler = handlers[message.messageType];
    if (!handler) {
      logOutputChannel.error(`Unable to handle ACE message: Command not available: "${message.messageType}".`);
      return;
    }

    handler();
  }

  /**
   * Handles the `init` message sent from the CWF (Centralized Webview Framework)
   * once the ACE webview has finished initializing on the client side.
   *
   * This method is responsible for marking the webview as initialized,
   * then either processing any messages that were queued while the webview
   * was not ready, or rendering the ACE content immediately if no messages
   * are pending.
   *
   * ### Background
   * VS Code restores the `webview.html` content from memory whenever a webview
   * panel is hidden and later made visible again
   * (see: https://code.visualstudio.com/api/extension-guides/webview#visibility-and-moving).
   * Because of that, if we only ever set `webview.html` once
   * during the initial render, VS Code will later restore that *initial* HTML,
   * not the most recent rendered state.
   *
   * In our case, this means that if the webview content has been updated via
   * `update-renderer` messages (without changing `webview.html`), then when the
   * panel is hidden and brought back to the foreground, VS Code restores outdated
   * HTML.
   *
   * Therefore, `handleInit` ensures that once the frontend reinitializes, the
   * extension-side state is properly synchronized by flushing queued messages
   * or re-rendering the ACE view with the latest stored state.
   *
   * @param message The message object sent from the webview.
   */
  private handleInit(message: MessageToIDEType) {
    const aceMessage = message.messageType === 'init' && message.payload === 'ace';
    if (!aceMessage) return;

    this.initialized = true;

    if (this.messageQueue.length > 0) {
      this.processQueuedMessages();
    } else {
      const { cwfProps: aceData, request } = this.state as CwfAceTabParams;
      if (aceData) void this.renderAce(request, aceData);
    }
  }

  private processQueuedMessages() {
    while (this.messageQueue.length > 0) {
      const queued = this.messageQueue.shift();

      if (queued) {
        void this.webViewPanel.webview.postMessage(queued);
      }
    }
  }

  private isActive() {
    return this.initialized;
  }

  private async updateWebView(request: RefactoringRequest) {
    const isStale = this.state?.isStale ?? false;

    await this.renderAce(request, getAceData({ request, isStale, error: false, loading: true }));

    try {
      const result = await request.promise;

      await this.renderAce(request, getAceData({ request, result, isStale, loading: false, error: false }));
    } catch (error) {
      await this.renderAce(request, getAceData({ request, isStale, error: true, loading: false }));
    }
  }

  private async renderAce(request: RefactoringRequest, aceData: AceContextViewProps) {
    this.state = { request, cwfProps: aceData };

    const message = {
      messageType: 'update-renderer',
      payload: aceData,
    };

    if (this.isActive()) {
      await this.webViewPanel.webview.postMessage(message);
    } else {
      if (!this.hasSetInitialScript) {
        const htmlContent = initBaseContent(this.webViewPanel.webview, aceData);
        this.webViewPanel.webview.html = htmlContent;

        this.hasSetInitialScript = true;
      } else {
        this.messageQueue.push(message);
      }
    }
  }

  dispose() {
    CodeSceneCWFAceTabPanel._instance = undefined;

    this.state = undefined;
    this.initialized = false;
    this.hasSetInitialScript = false;

    this.webViewPanel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  static show(request: RefactoringRequest) {
    void CodeSceneCWFAceTabPanel.instance.updateWebView(request);

    if (!CodeSceneCWFAceTabPanel.instance.webViewPanel.visible) {
      CodeSceneCWFAceTabPanel.instance.webViewPanel.reveal(undefined, true);
    }
  }
}
