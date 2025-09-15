// CS-5271
import vscode, { Disposable, ViewColumn, WebviewPanel } from 'vscode';
import { InteractiveDocsParams } from '../documentation/commands';
import { reportError, showDocAtPosition } from '../utils';
import { commonResourceRoots } from '../webview-utils';
import { MessageToIDEType } from '../centralized-webview-framework/types/messages';
import { DocsContextViewProps, FileMetaType } from '../centralized-webview-framework/types';
import { initBaseContent } from '../centralized-webview-framework/cwf-html-utils';

type CodeSceneTabPanelParams = InteractiveDocsParams & {
  isStale?: boolean;
};

function getDocsData(docType: string, fileData: FileMetaType): DocsContextViewProps {
  const docTypeCwf = getCWFDocType(docType);
  return {
    ideType: 'VSCode',
    view: 'docs',
    data: { docType: docTypeCwf, fileData },
  };
}

// Ensure the string is using the correct docs_issues_complex_method format no matter where the calls comes from (codelens/monitor)
function getCWFDocType(docType: string) {
  if (docType.includes('_')) return docType;
  return `docs_issues_${docType.toLowerCase().split(' ').join('_').replace(',', '')}`;
}

function getFileData(params: InteractiveDocsParams): FileMetaType {
  const { issueInfo, document } = params;
  const fileData: FileMetaType = {
    fileName: document.fileName,
    fn: issueInfo.fnName
      ? {
          name: issueInfo.fnName,
          range: issueInfo.position
            ? {
                startLine: issueInfo.position.line,
                startColumn: 0,
                endLine: issueInfo.position.line,
                endColumn: 1,
              }
            : undefined,
        }
      : undefined,
  };
  return fileData;
}

export class CodeSceneCWFDocsTabPanel implements Disposable {
  private static _instance: CodeSceneCWFDocsTabPanel | undefined;
  private static readonly viewType = 'codescene-tab';
  private readonly webViewPanel: WebviewPanel;
  private disposables: Disposable[] = [];
  private state?: CodeSceneTabPanelParams;
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
    return CodeSceneCWFDocsTabPanel.instance.webViewPanel.visible && this.initialized;
  }

  // Render webview either by creatign html or sending update-renderer message
  private async updateWebView(params: CodeSceneTabPanelParams) {
    this.state = params;
    const { issueInfo, document } = params;
    const fileData = getFileData(params);

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
    this.webViewPanel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  static show(params: CodeSceneTabPanelParams) {
    void CodeSceneCWFDocsTabPanel.instance.updateWebView(params);
    if (!CodeSceneCWFDocsTabPanel.instance.webViewPanel.visible) {
      CodeSceneCWFDocsTabPanel.instance.webViewPanel.reveal(undefined, true);
    }
  }
}
