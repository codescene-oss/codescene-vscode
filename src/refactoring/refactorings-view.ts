import * as vscode from 'vscode';
import { isDefined } from '../utils';
import { pendingSymbol, presentRefactoringCmdName, toConfidenceSymbol } from './command';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';
import { logOutputChannel } from '../log';

export class RefactoringsView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: RefactoringsTreeProvider;

  constructor() {
    this.treeDataProvider = new RefactoringsTreeProvider();
    this.disposables.push(this.treeDataProvider);

    const view = vscode.window.createTreeView('codescene.explorerAutoRefactorView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });
    this.disposables.push(view);

    this.disposables.push(
      this.treeDataProvider.onDidChangeTreeData((e) => {
        const entityFilename = this.treeDataProvider.activeFileName;
        view.description = entityFilename;
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand('codescene.gotoAndPresentRefactoring', this.gotoAndPresentRefactoring, this)
    );

    this.disposables.push(
      vscode.commands.registerCommand('codescene.revealFunctionInDocument', this.revealFunctionInDocument, this)
    );
  }

  private rangeOutsideAllVisibleRanges(target: vscode.Range, visibleRanges: readonly vscode.Range[]) {
    return visibleRanges.every((r) => !r.intersection(target));
  }

  /**
   * Checks the editor for the refactor target doc and see if we need to scroll into the range of the
   * targeted refactoring. This is necessary because the refactored function might not be in current view.
   *
   * @param request - can apparently be undefined when coming from codescene.explorerAutoRefactorView -> view/item/context
   */
  private gotoAndPresentRefactoring(request?: CsRefactoringRequest) {
    if (!isDefined(request)) {
      const msg = 'Got undefined request from context menu, please try again.';
      logOutputChannel.warn(msg);
      vscode.window.showWarningMessage(msg);
      return;
    }
    this.revealFunctionInDocument(request);
    vscode.commands.executeCommand(presentRefactoringCmdName, request);
  }

  private revealFunctionInDocument(request: CsRefactoringRequest) {
    const editor = request.targetEditor();
    if (editor) {
      editor.revealRange(request.fnToRefactor.range, vscode.TextEditorRevealType.Default);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

class RefactoringsTreeProvider implements vscode.TreeDataProvider<CsRefactoringRequest>, vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataChangedEmitter = new vscode.EventEmitter<CsRefactoringRequest | void>();
  readonly onDidChangeTreeData = this.treeDataChangedEmitter.event;

  private activeDocument: vscode.TextDocument | undefined;

  constructor() {
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
    if (isDefined(e) && e.document.uri.scheme === 'file') return e.document;
  }

  get activeFileName(): string | undefined {
    return this.activeDocument?.uri.path.split('/').pop();
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  getTreeItem(request: CsRefactoringRequest): vscode.TreeItem | Thenable<vscode.TreeItem> {
    const toString = (request: CsRefactoringRequest) => {
      const range = request.fnToRefactor.range;
      const symbol = toConfidenceSymbol(request);
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
      (r, i, rs) => rs.findIndex((rr) => rr.fnToRefactor.range.isEqual(r.fnToRefactor.range)) === i
    );
    return distinctPerFn.sort((a, b) => a.fnToRefactor.range.start.line - b.fnToRefactor.range.start.line);
  }
}
