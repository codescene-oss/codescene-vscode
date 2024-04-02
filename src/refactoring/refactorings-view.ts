import * as vscode from 'vscode';
import { reviewDocumentSelector } from '../language-support';
import { logOutputChannel } from '../log';
import Reviewer, { chScorePrefix } from '../review/reviewer';
import { isDefined } from '../utils';
import { pendingSymbol, presentRefactoringCmdName, toConfidenceSymbol } from './commands';
import { CsRefactoringRequest, CsRefactoringRequests, ResolvedRefactoring } from './cs-refactoring-requests';
import { targetEditor } from './utils';

export class RefactoringsView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: RefactoringsTreeProvider;
  private view: vscode.TreeView<CsRefactoringRequest>;

  constructor() {
    this.treeDataProvider = new RefactoringsTreeProvider();

    this.view = vscode.window.createTreeView('codescene.explorerAutoRefactorView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });
    this.disposables.push(this.view);

    this.disposables.push(
      this.treeDataProvider.onDidChangeTreeData(async (e) => {
        const fileName = this.treeDataProvider.activeFileName;
        this.view.description = fileName;
        if (isDefined(this.treeDataProvider.activeDocument)) {
          const diagnosticsForDoc = await Reviewer.instance.review(this.treeDataProvider.activeDocument);
          const score = diagnosticsForDoc.find((d) => d.message.startsWith(chScorePrefix));
          if (score) {
            // Add short code health score to the view description
            this.view.description = `${fileName} (${score.message.replace(chScorePrefix, 'score')})`;
          }
        }
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand('codescene.gotoAndPresentRefactoring', this.gotoAndPresentRefactoring, this)
    );

    this.disposables.push(
      vscode.commands.registerCommand('codescene.revealFunctionInDocument', this.revealFunctionInDocument, this)
    );
  }

  /**
   * Tries to get a resolved refactoring and present it in the refactoring panel.
   * Checks the editor for the refactor target doc and see if we need to scroll into the range of the
   * targeted refactoring. This is necessary because the refactored function might not be in current view.
   *
   * @param request - can apparently be undefined when coming from codescene.explorerAutoRefactorView -> view/item/context
   */
  private gotoAndPresentRefactoring(request?: CsRefactoringRequest) {
    if (!isDefined(request)) {
      const msg = 'Got undefined request from context menu, please try again.';
      logOutputChannel.warn(msg);
      void vscode.window.showWarningMessage(msg);
      return;
    }

    const response = request.resolvedResponse();
    if (!isDefined(response)) {
      const msg = 'No response for this refactoring yet.';
      logOutputChannel.warn(msg);
      void vscode.window.showWarningMessage(msg);
      return;
    }

    this.revealFunctionInDocument(response);
    void vscode.commands.executeCommand(presentRefactoringCmdName, response);
  }

  private revealFunctionInDocument(response: ResolvedRefactoring) {
    const editor = targetEditor(response.document);
    if (editor) {
      editor.revealRange(response.fnToRefactor.range, vscode.TextEditorRevealType.Default);
    }
  }

  dispose() {
    this.treeDataProvider.dispose(); // Dispose and clear the treedataprovider first, emptying the view
    this.view.description = ''; // Don't leave a trailling description when disposing the view

    this.disposables.forEach((d) => d.dispose());
  }
}

class RefactoringsTreeProvider implements vscode.TreeDataProvider<CsRefactoringRequest>, vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataChangedEmitter = new vscode.EventEmitter<CsRefactoringRequest | void>();
  readonly onDidChangeTreeData = this.treeDataChangedEmitter.event;
  private readonly documentSelector: vscode.DocumentSelector;

  activeDocument: vscode.TextDocument | undefined;

  constructor() {
    this.documentSelector = reviewDocumentSelector();

    this.activeDocument = this.validEditorDoc(vscode.window.activeTextEditor);

    const changeRequestsDisposable = CsRefactoringRequests.onDidChangeRequests(() => {
      this.treeDataChangedEmitter.fire();
    });
    this.disposables.push(changeRequestsDisposable);

    const changeTextEditorDisposable = vscode.window.onDidChangeActiveTextEditor((e) => {
      const newActiveDoc = this.validEditorDoc(e);
      if (isDefined(newActiveDoc)) {
        this.activeDocument = newActiveDoc;
        this.treeDataChangedEmitter.fire();
      }
    });
    this.disposables.push(changeTextEditorDisposable);
  }

  private validEditorDoc(e: vscode.TextEditor | undefined) {
    if (isDefined(e) && vscode.languages.match(this.documentSelector, e?.document) !== 0) return e.document;
  }

  get activeFileName(): string | undefined {
    return this.activeDocument?.uri.path.split('/').pop();
  }

  dispose() {
    // Force clear the tree by setting the activeDocument to undefined
    this.activeDocument = undefined;
    this.treeDataChangedEmitter.fire();

    this.disposables.forEach((d) => d.dispose());
  }

  getTreeItem(request: CsRefactoringRequest): vscode.TreeItem | Thenable<vscode.TreeItem> {
    const toString = (request: CsRefactoringRequest) => {
      const range = request.fnToRefactor.range;
      const symbol = toConfidenceSymbol(request.response?.confidence.level);
      return `${symbol || pendingSymbol} "${request.fnToRefactor.name}" [Ln ${range.start.line + 1}, Col ${
        range.start.character
      }]`;
    };

    const item = new vscode.TreeItem(toString(request), vscode.TreeItemCollapsibleState.None);
    item.tooltip = `Click to go to location in ${request.document.fileName.split('/').pop()}`;
    item.command = {
      title: 'Show in file',
      command: 'codescene.revealFunctionInDocument',
      arguments: [request],
    };
    return item;
  }

  getChildren(element?: CsRefactoringRequest | undefined): vscode.ProviderResult<CsRefactoringRequest[]> {
    if (element || !this.activeDocument) {
      return [];
    }
    const requestsForActiveDoc = CsRefactoringRequests.getAll(this.activeDocument);
    const presentableRefactoring = requestsForActiveDoc.filter((r) => r.shouldPresent());
    const distinctPerFn = presentableRefactoring.filter(
      (r, i, rs) => rs.findIndex((rr) => rr.traceId === r.traceId) === i
    );
    return distinctPerFn.sort((a, b) => a.fnToRefactor.range.start.line - b.fnToRefactor.range.start.line);
  }
}
