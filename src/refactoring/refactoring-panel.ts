import { readFile } from 'fs/promises';
import { join } from 'path';
import vscode, {
  Disposable,
  Range,
  Selection,
  TextDocument,
  TextEditorRevealType,
  Uri,
  ViewColumn,
  WebviewPanel,
  WorkspaceEdit,
} from 'vscode';
import { RefactorResponse } from '../cs-rest-api';
import { categoryToDocsCode } from '../csdoc';
import { logOutputChannel } from '../log';
import { getLogoUrl } from '../utils';
import { FnToRefactor } from './command';

interface CurrentRefactorState {
  range: Range; // Range of code to be refactored
  code: string; // The code to replace the range with
  document: TextDocument; // The document to apply the refactoring to
  initiatorViewColumn?: ViewColumn; // ViewColumn of the initiating editor
  applied?: boolean; // Whether the refactoring has been applied
}

interface RefactorPanelParams {
  document: TextDocument;
  initiatorViewColumn?: ViewColumn;
  fnToRefactor: FnToRefactor;
  response?: RefactorResponse | string;
}

export class RefactoringPanel {
  public static currentPanel: RefactoringPanel | undefined;
  private static readonly viewType = 'refactoringPanel';

  private readonly webViewPanel: WebviewPanel;
  private disposables: Disposable[] = [];

  private currentRefactorState: CurrentRefactorState | undefined;

  public constructor(private extensionUri: Uri) {
    this.webViewPanel = vscode.window.createWebviewPanel(
      RefactoringPanel.viewType,
      'CodeScene AI Refactor',
      ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(extensionUri, 'out'), Uri.joinPath(extensionUri, 'assets')],
      }
    );

    this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webViewPanel.webview.onDidReceiveMessage(
      async (message) => {
        if (!this.currentRefactorState) {
          logOutputChannel.info('No current refactoring state');
          return;
        }
        const refactoringState = this.currentRefactorState;
        switch (message.command) {
          case 'apply':
            await this.applyRefactoring(refactoringState);
            vscode.window.setStatusBarMessage(`$(sparkle) Successfully applied refactoring`, 3000);
            this.dispose();
            return;
          case 'reject':
            await this.rejectRefactoring(refactoringState);
            await this.deselectRefactoring(refactoringState);
            this.dispose();
            return;
          case 'close':
            await this.rejectRefactoring(refactoringState);
            this.dispose();
            return;
          case 'copy-code':
            vscode.window.setStatusBarMessage(`$(clippy) Copied refactoring suggestion to clipboard`, 3000);
            vscode.env.clipboard.writeText(refactoringState.code || '');
            return;
          case 'show-diff':
            await this.showDiff(refactoringState);
            return;
          case 'toggle-apply':
            await this.toggleApply(refactoringState);
            return;
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * Create a virtual document used for tmp diffing in the editor.
   * The scheme is registered with a content provider in extension.ts
   * @param name
   * @param content
   * @param languageId
   * @returns
   */
  private async createTempDocument(name: string, content: string, languageId: string) {
    const tmpUri = vscode.Uri.from({ scheme: 'tmp-diff', path: name, query: content });
    const tmpDoc = await vscode.workspace.openTextDocument(tmpUri);
    return vscode.languages.setTextDocumentLanguage(tmpDoc, languageId);
  }

  private async showDiff(refactoringState: CurrentRefactorState) {
    const { document, range, code } = refactoringState;

    // Create temporary virtual documents to use in the diff command. Just opening a new document with the new code
    // imposes a save dialog on the user when closing the diff.
    const originalCode = refactoringState.applied ? code : document.getText(range);
    const refactoringSuggestion = refactoringState.applied ? document.getText(range) : code;
    const originalCodeTmpDoc = await this.createTempDocument('original', originalCode, document.languageId);
    const refactoringTmpDoc = await this.createTempDocument('refactoring', refactoringSuggestion, document.languageId);

    // Make sure the initiator view is active, otherwise the diff might replace the entire Refactoring webview!
    await vscode.window.showTextDocument(document.uri, { viewColumn: refactoringState.initiatorViewColumn });

    await vscode.commands.executeCommand('vscode.diff', originalCodeTmpDoc.uri, refactoringTmpDoc.uri);
  }

  private async toggleApply(refactoringState: CurrentRefactorState) {
    const { document, range, code } = refactoringState;

    // Save previous code before applying
    const previousCode = document.getText(range);
    // Range of the applied refactoring
    const newRange = this.relativeRangeFromCode(range, code);

    const workSpaceEdit = new WorkspaceEdit();
    workSpaceEdit.replace(document.uri, range, code);
    await vscode.workspace.applyEdit(workSpaceEdit);
    await this.selectCurrentRefactoring(refactoringState);

    refactoringState.applied = !refactoringState.applied;
    refactoringState.code = previousCode;
    refactoringState.range = newRange;
  }

  private async applyRefactoring(refactoringState: CurrentRefactorState) {
    if (!refactoringState.applied) {
      await this.toggleApply(refactoringState);
    }
  }

  /**
   * Returns a new range locating the code relative the original range.
   * @param range
   * @param code
   */
  private relativeRangeFromCode(range: Range, code: string) {
    const lines = code.split(/\r\n|\r|\n/);
    const lineDelta = lines.length - 1;
    const characterDelta = lines[lines.length - 1].length;
    return new Range(range.start, range.start.translate({ lineDelta, characterDelta }));
  }

  private async selectCurrentRefactoring(refactoringState: CurrentRefactorState) {
    const { document, range, code, initiatorViewColumn } = refactoringState;
    const newRange = this.relativeRangeFromCode(range, code);

    const editor = await vscode.window.showTextDocument(document.uri, {
      preview: false,
      viewColumn: initiatorViewColumn,
    });
    editor.selection = new Selection(newRange.start, newRange.end);
    editor.revealRange(newRange, TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async rejectRefactoring(refactoringState: CurrentRefactorState) {
    if (refactoringState.applied) {
      await this.toggleApply(refactoringState);
    }
  }

  private async deselectRefactoring(refactoringState: CurrentRefactorState) {
    // Get original document and deselect the function to refactor.
    const { document, range, initiatorViewColumn } = refactoringState;
    const editor = await vscode.window.showTextDocument(document.uri, {
      preview: false,
      viewColumn: initiatorViewColumn,
    });
    editor.selection = new Selection(range.start, range.start);
  }

  private async updateWebView({ document, initiatorViewColumn, fnToRefactor, response }: RefactorPanelParams) {
    const refactorStylesCss = this.getUri('assets', 'refactor-styles.css');
    const markdownLangCss = this.getUri('assets', 'markdown-languages.css');
    const highlightCss = this.getUri('assets', 'highlight.css');
    const webviewScript = this.getUri('out', 'refactoring-webview-script.js');
    const csLogoUrl = await getLogoUrl(this.extensionUri.fsPath);
    const codiconsUri = this.getUri('out', 'codicons', 'codicon.css');

    const range = fnToRefactor.range;
    let content = this.loadingContent();
    let title = 'Refactoring...';
    switch (typeof response) {
      case 'string':
        this.currentRefactorState = { document, code: 'n/a', range, initiatorViewColumn };
        content = this.errorContent(response);
        title = 'Refactoring error';
        break;
      case 'object':
        let { code } = response;
        title = response.confidence.title;
        let trimmedCode = code.trim(); // Service might have returned code with extra whitespace. Trim to make it match startLine when replacing
        this.currentRefactorState = { document, code: trimmedCode, range, initiatorViewColumn };
        content = await this.autoRefactorOrCodeImprovementContent(response, trimmedCode, document.languageId);
        break;
    }

    // Note, the html "typehint" is used by the es6-string-html extension to enable highlighting of the html-string
    this.webViewPanel.webview.html = /*html*/ `
    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <link href="${markdownLangCss}" type="text/css" rel="stylesheet" />
        <link href="${highlightCss}" type="text/css" rel="stylesheet" />
        <link href="${codiconsUri}" type="text/css" rel="stylesheet" />
        <link href="${refactorStylesCss}" type="text/css" rel="stylesheet" />
    </head>

    <body>
        <script type="module" nonce="${nonce}" src="${webviewScript}"></script>
        <h1><img src="data:image/png;base64,${csLogoUrl}" width="64" height="64" align="center"/>&nbsp; ${title}</h1>
        ${content}
    </body>

    </html>
    `;
  }

  private getUri(...pathSegments: string[]) {
    return this.webViewPanel.webview.asWebviewUri(Uri.joinPath(this.extensionUri, ...pathSegments));
  }

  private async autoRefactorOrCodeImprovementContent(response: RefactorResponse, code: string, languageId: string) {
    const { level } = response.confidence;
    if (level >= 2) {
      return this.autoRefactorContent(response, code, languageId);
    }
    return this.codeImprovementContent(response, code, languageId);
  }

  private async codeContainerContent(code: string, languageId: string) {
    // Use built in  markdown extension for rendering code
    const mdRenderedCode = await vscode.commands.executeCommand(
      'markdown.api.render',
      '```' + languageId + '\n' + code + '\n```'
    );
    return /*html*/ `
    <div class="code-container">
      <vscode-button id="copy-to-clipboard" appearance="icon" aria-label="Copy code" title="Copy code">
        <span class="codicon codicon-clippy"></span>
      </vscode-button>
      ${mdRenderedCode}
    </div>`;
  }

  private async autoRefactorContent(response: RefactorResponse, code: string, languageId: string) {
    const { confidence, reasons } = response;
    const {
      level,
      'recommended-action': { details: actionDetails, description: action },
    } = confidence;
    const actionBadgeClass = `action-badge level-${level}`;

    let reasonsContent = '';
    if (reasons && reasons.length > 0) {
      const reasonText = reasons.map((reason) => `<li>${reason}</li>`).join('\n');
      reasonsContent = /*html*/ `
          <h4>Reasons for detailed review</h4>
          <ul>${reasonText}</ul>
        `;
    }

    const content = /*html*/ `
        <p> 
          <span class="${actionBadgeClass}">${action}</span> ${actionDetails}
        </p>  
        ${reasonsContent}
        ${await this.codeContainerContent(code, languageId)}
        <div class="bottom-controls">
          <div class="buttons-right">
            <vscode-button id="diff-button" aria-label="Show diff">Show diff</vscode-button>
            <vscode-checkbox id="toggle-apply">Preview</vscode-checkbox>
            <span> </span>
            <vscode-button id="reject-button" appearance="secondary" aria-label="Reject Refactoring" title="Reject refactoring">Reject</vscode-button>
            <vscode-button id="apply-button" appearance="primary" aria-label="Apply and close" title="Apply and close">Apply</vscode-button>
          </div>
        </div>
  `;
    return content;
  }

  private async codeSmellsGuide(codeSmell: string) {
    const docsPath = categoryToDocsCode(codeSmell) + '_guide.md';
    const path = join(this.extensionUri.path, 'docs', docsPath);
    const docsGuide = await readFile(path);
    return vscode.commands.executeCommand<string>('markdown.api.render', docsGuide.toString());
  }

  private async codeImprovementContent(response: RefactorResponse, code: string, languageId: string) {
    const {
      'refactoring-properties': { 'removed-code-smells': removedCodeSmells },
    } = response;

    let solutionContent;
    if (removedCodeSmells.length > 0) {
      solutionContent = await this.codeSmellsGuide(removedCodeSmells[0]);
    } else {
      solutionContent = await this.codeSmellsGuide('general-code-improvements');
    }

    const content = /*html*/ `
        ${solutionContent}
        <h4>Example from your code</h4>
        ${await this.codeContainerContent(code, languageId)}
        <div class="bottom-controls">
          <div class="buttons-right">
            <vscode-button id="diff-button" aria-label="Show diff">Show diff</vscode-button>
            <vscode-checkbox id="toggle-apply">Preview</vscode-checkbox>
            <span> </span>
            <vscode-button id="close-button" appearance="primary" aria-label="Close" title="Close">Close</vscode-button>
          </div>
        </div>
  `;
    return content;
  }

  private loadingContent() {
    return /*html*/ `<div class="loading-content">
      <vscode-progress-ring class="progress-ring"></vscode-progress-ring><span id="loading-span"></span>
    </div>`;
  }

  private errorContent(errorMessage: string) {
    return /*html*/ `<h2>Refactoring failed</h2>
    <p>${errorMessage}</p>
    <div class="buttons">
      <vscode-button id="reject-button" appearance="primary">Close</vscode-button>
    </div>
`;
  }

  public dispose() {
    RefactoringPanel.currentPanel = undefined;
    this.webViewPanel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  /**
   *
   * @param extensionUri Used to resolve resource paths for the webview content
   * @param document Ref to document to apply refactoring to
   * @param request
   * @param response
   * @returns
   */
  public static createOrShow({
    extensionUri,
    document,
    initiatorViewColumn,
    fnToRefactor,
    response,
  }: RefactorPanelParams & { extensionUri: Uri }) {
    if (RefactoringPanel.currentPanel) {
      RefactoringPanel.currentPanel.updateWebView({ document, initiatorViewColumn, fnToRefactor, response });
      RefactoringPanel.currentPanel.webViewPanel.reveal(initiatorViewColumn ? ViewColumn.Beside : ViewColumn.Active);
      return;
    }

    // Otherwise, create a new web view panel.
    RefactoringPanel.currentPanel = new RefactoringPanel(extensionUri);
    RefactoringPanel.currentPanel.updateWebView({ document, initiatorViewColumn, fnToRefactor, response });
  }
}

function nonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
