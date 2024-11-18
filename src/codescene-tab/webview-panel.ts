import vscode, { Disposable, Uri, ViewColumn, WebviewPanel } from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { InteractiveDocsParams, isInteractiveDocsParams } from '../documentation/commands';
import { logOutputChannel } from '../log';
import { FnToRefactor } from '../refactoring/capabilities';
import { RefactoringRequest } from '../refactoring/request';
import { decorateCode, targetEditor } from '../refactoring/utils';
import Telemetry from '../telemetry';
import { isError } from '../utils';
import { commonResourceRoots } from '../webview-utils';
import { functionLocationContent } from './webview/components';
import { docsForCategory } from './webview/documentation-components';
import {
  customRefactoringSummary,
  refactoringButton,
  refactoringContent,
  refactoringError,
  refactoringSummary,
} from './webview/refactoring-components';
import { renderHtmlTemplate } from './webview/utils';

interface ShowAceAcknowledgement {
  document: vscode.TextDocument;
  fnToRefactor: FnToRefactor;
}

type CodeSceneTabPanelParams = InteractiveDocsParams | RefactoringRequest | ShowAceAcknowledgement;

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
    this.webViewPanel.webview.onDidReceiveMessage(
      async (message) => {
        try {
          if (!this.state) return;
          if (this.state instanceof RefactoringRequest) {
            await this.handleRefactoringMessage(this.state, message.command);
          } else if (isInteractiveDocsParams(this.state)) {
            await this.handleDocumentationMessage(this.state, message.command);
          } else {
            await this.handleAceAcknowledgementMessage(this.state, message.command);
          }
        } catch (error) {
          if (!isError(error)) return;
          void vscode.window.showErrorMessage(error.message);
          logOutputChannel.error(error.message);
        }
      },
      this,
      this.disposables
    );
  }

  private async handleAceAcknowledgementMessage(ackParams: ShowAceAcknowledgement, command: string) {
    switch (command) {
      case 'acknowledged':
        await CsExtensionState.setAcknowledgedAceUsage(true);
        Telemetry.instance.logUsage('aceAcknowledged');
        void vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          ackParams.document,
          ackParams.fnToRefactor
        );
        return;
      case 'goto-function-location':
        this.goToFunctionLocation(ackParams.document.uri, ackParams.fnToRefactor.range.start);
        return;
    }
  }

  private async handleRefactoringMessage(refactoring: RefactoringRequest, command: string) {
    const commands: { [key: string]: () => void } = {
      gotoFunctionLocation: () =>
        this.goToFunctionLocation(refactoring.document.uri, refactoring.fnToRefactor.range.start),
      apply: async () => {
        vscode.commands.executeCommand('codescene.applyRefactoring', refactoring).then(
          () => {
            this.dispose();
          },
          (error) => {
            logOutputChannel.error(error);
            this.dispose();
          }
        );
      },
      reject: () => {
        this.deselectRefactoring(refactoring);
        this.dispose();
      },
      retry: async () => {
        await vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          refactoring.document,
          refactoring.fnToRefactor,
          true
        );
      },
      copyCode: async () => {
        await this.copyCode(refactoring);
      },
      showDiff: () => {
        void vscode.commands.executeCommand('codescene.showDiffForRefactoring', refactoring);
      },
      showLogoutput: () => {
        logOutputChannel.show();
      },
    };

    const cmd = commands[command];

    if (!cmd) throw new Error(`Command not implemented: "${command}"!`);
    cmd.call(this);
  }

  private deselectRefactoring(refactoring: RefactoringRequest) {
    const editor = targetEditor(refactoring.document);
    if (editor) {
      editor.selection = new vscode.Selection(0, 0, 0, 0);
    }
  }

  private async copyCode(refactoring: RefactoringRequest) {
    const decoratedCode = decorateCode(await refactoring.promise, refactoring.document.languageId);
    await vscode.env.clipboard.writeText(decoratedCode);
    void vscode.window.showInformationMessage('Copied refactoring suggestion to clipboard');
  }

  private async handleDocumentationMessage(params: InteractiveDocsParams, command: string) {
    switch (command) {
      case 'goto-function-location':
        this.goToFunctionLocation(params.document.uri, params.issueInfo.position);
        return;
      case 'request-and-present-refactoring':
        void vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          params.document,
          params.fnToRefactor
        );
        return;
      default:
        throw new Error(`Command not implemented: "${command}"!`);
    }
  }

  private goToFunctionLocation(uri: Uri, pos: vscode.Position) {
    const location = new vscode.Location(uri, pos);
    void vscode.commands.executeCommand('editor.action.goToLocations', uri, pos, [location]);
  }

  private async updateWebView(params: InteractiveDocsParams | RefactoringRequest | ShowAceAcknowledgement) {
    this.state = params;
    if (params instanceof RefactoringRequest) {
      await this.presentRefactoring(params);
      return;
    } else if (isInteractiveDocsParams(params)) {
      await this.presentDocumentation(params);
      return;
    } else {
      this.presentAceAcknowledgement(params.fnToRefactor);
    }
  }

  private presentAceAcknowledgement(fnToRefactor: FnToRefactor) {
    const fnLocContent = functionLocationContent({
      filePath: fnToRefactor.filePath,
      position: fnToRefactor.range.start,
      fnName: fnToRefactor.name,
    });

    const ackContent = /*html*/ `
      <div class="ace-acknowledgement-container">
        <p class="header">CodeScene ACE - AI-Powered Refactoring</p>
        <p>CodeScene ACE combines multiple LLMs with fact-based validation. ACE chooses the best LLM for the job, 
        validates its output, and proposes refactoring for cleaner code which is easier to maintain.</p>
        <p>CodeScene ACE is built on our CodeHealth™ Metric, the only code analysis metric with a proven business impact.</p>
        <a href="https://codescene.com/product/ace/principles">View CodeScene's AI Privacy Principles</a><br>
        <vscode-button id="acknowledge-button">Show me CodeScene ACE</vscode-button>
        <hr>
        <p class="dimmed">You can disable CodeScene ACE anytime in settings.</p>
      </div>
    `;

    renderHtmlTemplate(this.webViewPanel, {
      title: 'CodeScene ACE  - AI Powered Refactoring',
      bodyContent: [fnLocContent, ackContent],
      cssPaths: [['out', 'codescene-tab', 'webview', 'ace-acknowledgement-styles.css']],
      scriptPaths: [['out', 'codescene-tab', 'webview', 'ace-acknowledgement-script.js']],
    });
  }

  private async presentRefactoring(refactoring: RefactoringRequest) {
    const { fnToRefactor, promise, document } = refactoring;

    const fnLocContent = functionLocationContent({
      filePath: fnToRefactor.filePath,
      position: fnToRefactor.range.start,
      fnName: fnToRefactor.name,
    });

    this.updateRefactoringContent('Refactoring...', [
      fnLocContent,
      `<div class="loading-content">
         <vscode-progress-ring class="progress-ring"></vscode-progress-ring>
       </div>`,
    ]);

    try {
      const response = await promise;
      const {
        confidence: { level, title },
      } = response;

      const highlightCode = level > 1;
      const editor = targetEditor(document);
      if (highlightCode && editor) {
        editor.selection = new vscode.Selection(fnToRefactor.range.start, fnToRefactor.range.end);
      }

      Telemetry.instance.logUsage('refactor/presented', { 'trace-id': refactoring.traceId, confidence: level });
      this.updateRefactoringContent(title, [
        fnLocContent,
        refactoringSummary(response.confidence),
        await refactoringContent(response, document.languageId),
      ]);
    } catch (error) {
      const title = 'Refactoring Failed';
      const actionHtml = `
        There was an error when performing this refactoring. 
        Please see the <a href="" id="show-logoutput-link">CodeScene Log</a> output for error details.`;

      const summaryContent = customRefactoringSummary('error', 'Refactoring Failed', actionHtml);

      Telemetry.instance.logUsage('refactor/presented', { 'trace-id': refactoring.traceId, confidence: 'error' });
      this.updateRefactoringContent(title, [fnLocContent, summaryContent, refactoringError()]);
    }
  }

  private updateRefactoringContent(title: string, content: string | string[]) {
    renderHtmlTemplate(this.webViewPanel, {
      title,
      bodyContent: content,
      cssPaths: [['out', 'codescene-tab', 'webview', 'refactoring-styles.css']],
      scriptPaths: [['out', 'codescene-tab', 'webview', 'refactoring-script.js']],
    });
  }

  private async presentDocumentation(params: InteractiveDocsParams) {
    const { issueInfo, document } = params;
    const title = issueInfo.category;

    const fnLocContent = functionLocationContent({
      filePath: document.uri.fsPath,
      position: issueInfo.position,
      fnName: issueInfo.fnName,
    });

    let fnToRefactor = params.fnToRefactor;
    // If we haven't been provided with a function to refactor, try to find one
    // This is the case when presenting documentation from a codelens or codeaction,
    // and unfortunately in the case of presenting from a delta analysis with an unsupported code smell...
    if (!fnToRefactor) {
      fnToRefactor = (
        await CsExtensionState.aceCapabilities?.getFunctionsToRefactor(document, [
          { category: issueInfo.category, line: issueInfo.position.line + 1 },
        ])
      )?.[0];
    }

    const buttonContent = `
      <div class="button-container">
        ${refactoringButton(fnToRefactor)}
      </div>
    `;

    const docsContent = await docsForCategory(issueInfo.category);

    this.updateContentWithDocScripts(title, [fnLocContent, buttonContent, docsContent]);
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
