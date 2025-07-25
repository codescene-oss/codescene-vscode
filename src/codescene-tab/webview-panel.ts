import vscode, { Disposable, ViewColumn, WebviewPanel } from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { DevtoolsAPI } from '../devtools-api';
import { FnToRefactor } from '../devtools-api/refactor-models';
import { CodeSmell } from '../devtools-api/review-model';
import { InteractiveDocsParams, isInteractiveDocsParams } from '../documentation/commands';
import { logOutputChannel } from '../log';
import { RefactoringRequest } from '../refactoring/request';
import { decorateCode, targetEditor } from '../refactoring/utils';
import Telemetry from '../telemetry';
import { reportError, showDocAtPosition } from '../utils';
import { commonResourceRoots } from '../webview-utils';
import { fileChangesDetectedContent, functionLocationContent } from './webview/components';
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

type CodeSceneTabPanelParams = (InteractiveDocsParams | RefactoringRequest | ShowAceAcknowledgement) & {
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
    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (!this.state) return;
        const { document, fnToRefactor } = this.state;
        if (document !== e.document || e.contentChanges.length === 0) return;
        const isStale = this.isFunctionUnchangedInDocument(document, fnToRefactor);

        // (cast this.state.isStale to boolean to avoid a first glitch when changing state from undefined to false)
        if (isStale !== !!this.state.isStale) {
          this.state.isStale = isStale;
          void this.updateWebView(this.state);
        }
      },
      this,
      this.disposables
    );
    vscode.workspace.onDidCloseTextDocument(
      (e) => {
        const closedThisDoc = this.state?.document === e;
        if (closedThisDoc) this.dispose();
      },
      this,
      this.disposables
    );
  }

  private isFunctionUnchangedInDocument(document: vscode.TextDocument, fnToRefactor?: FnToRefactor) {
    if (!fnToRefactor) return false;
    const contentAtRange = document.getText(fnToRefactor.vscodeRange);
    if (contentAtRange === fnToRefactor.body) return false;

    const ixOfContent = document.getText().indexOf(fnToRefactor.body);
    if (ixOfContent >= 0) {
      // Content matches, but function has been moved - update fnToRefactorRange!
      const newPos = document.positionAt(ixOfContent);
      const r = fnToRefactor.vscodeRange;
      const newRange = r.with(newPos, r.end.translate(newPos.line - r.start.line));
      fnToRefactor.vscodeRange = newRange;
      return false;
    }
    return true;
  }

  private async handleMessages(message: any) {
    try {
      if (!this.state) return;
      if (message.command === 'close') {
        this.dispose();
        return;
      }
      if (this.state instanceof RefactoringRequest) {
        await this.handleRefactoringMessage(this.state, message.command, this.state.isStale);
      } else if (isInteractiveDocsParams(this.state)) {
        await this.handleDocumentationMessage(this.state, message.command);
      } else {
        await this.handleAceAcknowledgementMessage(this.state, message.command);
      }
    } catch (e) {
      reportError({ context: 'CodeScene tab message handling', e });
    }
  }

  private async handleAceAcknowledgementMessage(ackParams: ShowAceAcknowledgement, command: string) {
    switch (command) {
      case 'acknowledged':
        await CsExtensionState.setAcknowledgedAceUsage(true);
        Telemetry.logUsage('ace-info/acknowledged');
        void vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          ackParams.document,
          'ace-acknowledgement',
          ackParams.fnToRefactor
        );
        return;
      case 'goto-function-location':
        void showDocAtPosition(ackParams.document, ackParams.fnToRefactor.vscodeRange.start);
        return;
    }
  }

  private async handleRefactoringMessage(refactoring: RefactoringRequest, command: string, isStale?: boolean) {
    const commands: { [key: string]: () => void } = {
      gotoFunctionLocation: async () => {
        await showDocAtPosition(refactoring.document, refactoring.fnToRefactor.vscodeRange.start);
        void this.highlightCode(refactoring, isStale);
      },
      apply: async () => {
        try {
          await vscode.commands.executeCommand('codescene.applyRefactoring', refactoring);
          this.dispose();
        } catch (e) {
          reportError({ context: 'Error applying refactoring', e });
          this.dispose();
        }
      },
      reject: () => {
        this.deselectRefactoring(refactoring);
        Telemetry.logUsage('refactor/rejected', refactoring.eventData);
        this.dispose();
      },
      retry: async () => {
        await vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          refactoring.document,
          'retry',
          refactoring.fnToRefactor,
          true
        );
      },
      copyCode: async () => {
        Telemetry.logUsage('refactor/copy-code', refactoring.eventData);
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
        void showDocAtPosition(params.document, params.issueInfo.position);
        return;
      case 'request-and-present-refactoring':
        void vscode.commands.executeCommand(
          'codescene.requestAndPresentRefactoring',
          params.document,
          'interactive-docs',
          params.fnToRefactor
        );
        return;
      default:
        throw new Error(`Command not implemented: "${command}"!`);
    }
  }

  private async updateWebView(params: CodeSceneTabPanelParams) {
    this.state = params;
    if (params instanceof RefactoringRequest) {
      await this.presentRefactoring(params, params.isStale);
      return;
    } else if (isInteractiveDocsParams(params)) {
      await this.presentDocumentation(params, params.isStale);
      return;
    } else {
      this.presentAceAcknowledgement(params.fnToRefactor, params.document);
    }
  }

  private presentAceAcknowledgement(fnToRefactor: FnToRefactor, document: vscode.TextDocument) {
    const fnLocContent = functionLocationContent({
      filePath: document.fileName,
      position: fnToRefactor.vscodeRange.start,
      fnName: fnToRefactor.name,
    });

    const ackContent = /*html*/ `
      <div class="ace-acknowledgement-container">
        <h4>CodeScene ACE - AI-Powered Refactoring</h4>
        <p><a href="https://codescene.com/product/ai-coding">CodeScene ACE</a> combines multiple LLMs with fact-based validation. 
        ACE chooses the best LLM for the job, validates its output, and proposes refactoring for cleaner code which is easier 
        to maintain.</p>
        <p>CodeScene ACE is built on our CodeHealth™ Metric, the only code analysis metric with a 
        <a href="https://codescene.com/hubfs/web_docs/Business-impact-of-code-quality.pdf?utm_campaign=AI Coding&utm_source=IDE&utm_medium=extension&utm_content=code-red">
        proven business impact</a>.</p>

        <ul>
          <li><span class="codicon codicon-check green"></span> Your code is never stored by us or the LLMs</li>
          <li><span class="codicon codicon-check green"></span> Your code snippets are shared only with select LLMs</li>
          <li><span class="codicon codicon-check green"></span> Your code is not used to train any LLM</li>
          <li><span class="codicon codicon-check green"></span> All communications with CodeScene ACE is fully encrypted</li>
        </ul>

        <a href="https://codescene.com/product/ace/principles" class="privacy-link">View CodeScene's AI Privacy Principles</a><br>
        <div class="button-container">
          <vscode-button id="acknowledge-button">Show me CodeScene ACE</vscode-button>
        </div>
        <p class="fineprint">You can disable CodeScene ACE anytime in settings.</p>
      </div>
    `;

    renderHtmlTemplate(this.webViewPanel, {
      title: 'CodeScene ACE  - AI Powered Refactoring',
      bodyContent: [fnLocContent, ackContent],
      cssPaths: [['out', 'codescene-tab', 'webview', 'ace-acknowledgement-styles.css']],
      scriptPaths: [['out', 'codescene-tab', 'webview', 'ace-acknowledgement-script.js']],
    });
  }

  private async presentRefactoring(refactoring: RefactoringRequest, isStale = false) {
    const { fnToRefactor, promise, document } = refactoring;

    const fnLocContent = functionLocationContent({
      filePath: document.fileName,
      position: fnToRefactor.vscodeRange.start,
      fnName: fnToRefactor.name,
      isStale,
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
        metadata: { 'cached?': isCached },
      } = response;

      await this.highlightCode(refactoring, isStale);

      const summaryContent = !isStale
        ? refactoringSummary(response.confidence)
        : fileChangesDetectedContent(
            'The function has been changed, so the refactoring might no longer apply. If the change was intentional, please reopen the panel to have ACE refactor the latest state of the function. If not, you might want to undo your changes.'
          );

      Telemetry.logUsage('refactor/presented', { confidence: level, isCached, ...refactoring.eventData });
      this.updateRefactoringContent(title, [
        fnLocContent,
        summaryContent,
        await refactoringContent(response, document.languageId, isStale),
      ]);
    } catch (e) {
      const title = 'Refactoring Failed';
      const actionHtml = `
        There was an error when performing this refactoring. 
        Please see the <a href="" id="show-logoutput-link">CodeScene Log</a> output for error details.`;

      const summaryContent = customRefactoringSummary(-1, 'Refactoring Failed', actionHtml);

      Telemetry.logUsage('refactor/presented', { confidence: 'error', ...refactoring.eventData });
      this.updateRefactoringContent(title, [fnLocContent, summaryContent, refactoringError()]);
    }
  }

  private async highlightCode(refactoring: RefactoringRequest, isStale?: boolean) {
    const { fnToRefactor, document } = refactoring;
    const result = await refactoring.promise;
    const highlightCode = !isStale;
    const editor = targetEditor(document);
    if (highlightCode && editor) {
      editor.selection = new vscode.Selection(fnToRefactor.vscodeRange.start, fnToRefactor.vscodeRange.end);
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

  private async getOrFindFnToRefactor(params: InteractiveDocsParams) {
    const { issueInfo, document, fnToRefactor } = params;
    if (fnToRefactor) return fnToRefactor;

    // If we haven't been provided with a function to refactor, try to find one
    // This is the case when presenting documentation from a codelens or codeaction,
    // and unfortunately in the case of presenting from a delta analysis with an unsupported code smell...
    if (issueInfo.position) {
      // Small hack, using the category and issue line info and create a codesmell for use below
      const codeSmell: CodeSmell = {
        details: '',
        category: issueInfo.category,
        'highlight-range': {
          'start-line': issueInfo.position.line,
          'end-line': -1,
          'start-column': -1,
          'end-column': -1,
        },
      };
      return await DevtoolsAPI.fnsToRefactorFromCodeSmell(document, codeSmell);
    }
  }

  private async presentDocumentation(params: InteractiveDocsParams, isStale = false) {
    const { issueInfo, document } = params;
    const title = issueInfo.category;

    let fnToRefactor = await this.getOrFindFnToRefactor(params);

    const fnLocContent = functionLocationContent({
      filePath: document.fileName,
      position: issueInfo.position,
      fnName: issueInfo.fnName || fnToRefactor?.name,
      isStale,
    });

    const staleContent = isStale
      ? fileChangesDetectedContent(
          'The function has been changed, so the issue might no longer apply. If the change was intentional, please reopen the panel to check the latest state of the function. If not, you might want to undo your changes.'
        )
      : '';

    const buttonContent = isStale
      ? ''
      : `<div class="button-container">
          ${refactoringButton(fnToRefactor)}
        </div>
        `;

    const docsContent = await docsForCategory(issueInfo.category);

    this.updateContentWithDocScripts(title, [fnLocContent, staleContent, buttonContent, docsContent]);
  }

  private updateContentWithDocScripts(title: string, content: string | string[]) {
    renderHtmlTemplate(this.webViewPanel, {
      title,
      bodyContent: content,
      scriptPaths: [['out', 'codescene-tab', 'webview', 'documentation-script.js']],
    });
  }

  dispose() {
    if (this.state instanceof RefactoringRequest) {
      this.state.abort();
    }
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
