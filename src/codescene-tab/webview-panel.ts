import vscode, { Disposable, ViewColumn, WebviewPanel } from 'vscode';
import { InteractiveDocsParams, isInteractiveDocsParams } from '../documentation/commands';
import { logOutputChannel } from '../log';
import { isError, showDocAtPosition } from '../utils';
import { commonResourceRoots } from '../webview-utils';
import { fileChangesDetectedContent, functionLocationContent } from './webview/components';
import { docsForCategory } from './webview/documentation-components';
import { renderHtmlTemplate } from './webview/utils';

type CodeSceneTabPanelParams = InteractiveDocsParams & {
  isStale?: boolean;
};

export class CodeSceneTabPanel implements Disposable {
  private static _instance: CodeSceneTabPanel | undefined;
  private static readonly viewType = 'codescene-tab';
  private readonly webViewPanel: WebviewPanel;
  private disposables: Disposable[] = [];
  private state?: CodeSceneTabPanelParams;

  public static get instance() {
    if (!CodeSceneTabPanel._instance) {
      CodeSceneTabPanel._instance = new CodeSceneTabPanel();
    }
    return CodeSceneTabPanel._instance;
  }

  constructor() {
    this.webViewPanel = vscode.window.createWebviewPanel(
      CodeSceneTabPanel.viewType,
      'CodeScene',
      { viewColumn: ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: commonResourceRoots(),
        // retainContextWhenHidden: true, // Might this to keep the state of the auto-refactor button then moving the webview tab around. It's
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

  private async handleMessages(message: any) {
    try {
      if (!this.state) return;
      if (message.command === 'close') {
        this.dispose();
        return;
      }
      const a = this.state;
      if (isInteractiveDocsParams(this.state)) {
        await this.handleDocumentationMessage(this.state, message.command);
      }
    } catch (error) {
      if (!isError(error)) return;
      void vscode.window.showErrorMessage(error.message);
      logOutputChannel.error(error.message);
    }
  }

  private async handleDocumentationMessage(params: InteractiveDocsParams, command: string) {
    switch (command) {
      case 'goto-function-location':
        void showDocAtPosition(params.document, params.issueInfo.position);
        return;
      default:
        throw new Error(`Command not implemented: "${command}"!`);
    }
  }

  private async updateWebView(params: CodeSceneTabPanelParams) {
    this.state = params;
    if (isInteractiveDocsParams(params)) {
      await this.presentDocumentation(params, params.isStale);
    }
  }

  private async presentDocumentation(params: InteractiveDocsParams, isStale = false) {
    const { issueInfo, document } = params;
    const title = issueInfo.category;

    const fnLocContent = functionLocationContent({
      filePath: document.uri.fsPath,
      position: issueInfo.position,
      fnName: issueInfo.fnName,
      isStale,
    });

    const staleContent = isStale
      ? fileChangesDetectedContent(
          'The function has been changed, so the issue might no longer apply. If the change was intentional, please reopen the panel to check the latest state of the function. If not, you might want to undo your changes.'
        )
      : '';

    const docsContent = await docsForCategory(issueInfo.category);

    this.updateContentWithDocScripts(title, [fnLocContent, staleContent, docsContent]);
  }

  private updateContentWithDocScripts(title: string, content: string | string[]) {
    renderHtmlTemplate(this.webViewPanel, {
      title,
      bodyContent: content,
      scriptPaths: [['out', 'codescene-tab', 'webview', 'documentation-script.js']],
    });
  }

  dispose() {
    CodeSceneTabPanel._instance = undefined;
    this.webViewPanel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  static show(params: CodeSceneTabPanelParams) {
    void CodeSceneTabPanel.instance.updateWebView(params);
    if (!CodeSceneTabPanel.instance.webViewPanel.visible) {
      CodeSceneTabPanel.instance.webViewPanel.reveal(undefined, true);
    }
  }
}
