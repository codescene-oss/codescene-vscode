import vscode, { Disposable, ViewColumn, WebviewPanel } from 'vscode';
import { MessageToIDEType } from '../../../centralized-webview-framework/types/messages';
import { showDocAtPosition } from '../../../utils';
import { commonResourceRoots } from '../../../webview-utils';
import Telemetry from '../../../telemetry';
import {
  copyCode,
  decorateCode,
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
import { AbortError } from '../../../devtools-api/abort-error';
import { DevtoolsError } from '../../../devtools-api/devtools-error';
import { MissingAuthTokenError } from '../../../missing-auth-token-error';

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
        if (closedThisDoc) this.webViewPanel.dispose();
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
      reportError({ context: 'An error occurred in the CodeScene ACE panel', e });
    }
  }

  private async handleAceMessage(request: RefactoringRequest, message: MessageToIDEType) {
    const handlers: Record<string, () => void> = {
      init: () => this.handleInit(message),
      apply: async () => {
        try {
          await vscode.commands.executeCommand('codescene.applyRefactoring', request);
          this.webViewPanel.dispose();
        } catch (e) {
          reportError({ context: 'Error applying refactoring', e });
          this.webViewPanel.dispose();
        }
      },
      reject: () => {
        deselectRefactoring(request);
        Telemetry.logUsage('refactor/rejected', request.eventData);
        this.webViewPanel.dispose();
      },
      close: () => {
        this.webViewPanel.dispose();
        return;
      },
      retry: async () => {
        await vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          request.document,
          'retry',
          request.fnToRefactor,
          // Having true here means skipping cache, meaning retry to get another refactoring
          // if the first one is not what you want...
          // But this seem to be used to retry when failed and we definitely don't want to skip cache then
          false //true
        );
      },
      showDiff: () => {
        void vscode.commands.executeCommand('codescene.showDiffForRefactoring', request);
      },
      copyCode: async () => {
        const copyCodeMessage = message as Extract<MessageToIDEType, { messageType: 'copyCode' }>;
        const code = copyCodeMessage.payload?.code;

        Telemetry.logUsage('refactor/copy-code', request.eventData);

        if (code) {
          await copyCode(code);
        } else {
          logOutputChannel.warn('Could not copy refactored code as it is undefined.');
        }
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
        this.webViewPanel.dispose();
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

    await this.renderAce(request, getAceData({ request, isStale, loading: true }));

    try {
      const result = await request.promise;
      result.code = decorateCode(result, request.document.languageId);

      await this.renderAce(request, getAceData({ request, result, isStale, loading: false }));
    } catch (error) {
      void this.handleErrorState(request, isStale, error);
    }
  }

  private async handleErrorState(request: RefactoringRequest, isStale: boolean, error: unknown) {
    // Ignore abort errors
    if (error instanceof AbortError) {
      logOutputChannel.info(
        `Refactor request aborted ${logIdString(request.fnToRefactor, request.traceId)}${
          request.skipCache === true ? ' (retry)' : ''
        }`
      );
      return;
    }

    let errorType = 'generic';

    const isMissingToken = error instanceof MissingAuthTokenError;
    const isAuthError = error instanceof DevtoolsError && error.status === 401;
    if (isMissingToken || isAuthError) {
      errorType = 'auth';
    }

    await this.renderAce(request, getAceData({ request, isStale, error: errorType, loading: false }));
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

    this.disposables.forEach((d) => d.dispose());
  }

  static show(request: RefactoringRequest) {
    void CodeSceneCWFAceTabPanel.instance.updateWebView(request);

    if (!CodeSceneCWFAceTabPanel.instance.webViewPanel.visible) {
      CodeSceneCWFAceTabPanel.instance.webViewPanel.reveal(undefined, true);
    }
  }
}
