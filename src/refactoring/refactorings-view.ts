/**
 * Shows couplings in the Explorer panel.
 *
 * The purpose of this view is to show the user which files are related to the one that is
 * currently active in the editor. The user can jump to these files by clicking on them.
 */
import * as vscode from 'vscode';
import { isDefined } from '../utils';
import { pendingSymbol, presentRefactoringCmdName, toConfidenceSymbol } from './command';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';

export class RefactoringsView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: RefactoringsTreeProvider;

  constructor() {
    this.treeDataProvider = new RefactoringsTreeProvider();
    this.disposables.push(this.treeDataProvider);

    const view = vscode.window.createTreeView('codescene.explorerACEView', {
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

    const gotoAndPresentRefactoringCmd = vscode.commands.registerCommand(
      'codescene.gotoAndPresentRefactoring',
      this.gotoAndPresentRefactoring,
      this
    );
    this.disposables.push(gotoAndPresentRefactoringCmd);
  }

  private rangeOutsideAllVisibleRanges(target: vscode.Range, visibleRanges: readonly vscode.Range[]) {
    return visibleRanges.every((r) => !r.intersection(target));
  }

  /**
   * Checks the editor for the refactor target doc and see if we need to scroll into the range of the
   * targeted refactoring. This is necessary because the refactored function might not be in current view.
   * @param refactoringRequest
   */
  gotoAndPresentRefactoring(refactoringRequest: CsRefactoringRequest) {
    const editorForDoc = vscode.window.visibleTextEditors.find((e) => e.document === refactoringRequest.document);
    if (
      isDefined(editorForDoc) &&
      this.rangeOutsideAllVisibleRanges(refactoringRequest.fnToRefactor.range, editorForDoc.visibleRanges)
    ) {
      editorForDoc.revealRange(
        refactoringRequest.fnToRefactor.range,
        vscode.TextEditorRevealType.Default
      );
    }
    vscode.commands.executeCommand(presentRefactoringCmdName, refactoringRequest);
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
        vscode.window.onDidChangeVisibleTextEditors((editors) => {});
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
      const symbol = toConfidenceSymbol(request.resolvedResponse?.confidence.level);
      return `${symbol || pendingSymbol} "${request.fnToRefactor.name}" [${range.start.line}:${range.start.character}]`;
    };

    const item = new vscode.TreeItem(toString(request), vscode.TreeItemCollapsibleState.None);
    item.tooltip = `Click to go to location in the ${this.activeFileName}`;
    item.command = {
      title: 'Show in file',
      command: 'editor.action.goToLocations',
      arguments: [this.activeDocument?.uri, request.fnToRefactor.range.start, [], 'goto', ''],
    };
    return item;
  }

  getChildren(element?: CsRefactoringRequest | undefined): vscode.ProviderResult<CsRefactoringRequest[]> {
    if (element || !this.activeDocument) {
      return [];
    }
    const requestsForActiveDoc = CsRefactoringRequests.getAll(this.activeDocument);
    const pendingOrSuccessful = requestsForActiveDoc.filter((r) => !isDefined(r.error));
    const distinctPerFn = pendingOrSuccessful.filter(
      (r, i, rs) => rs.findIndex((rr) => rr.fnToRefactor.range.isEqual(r.fnToRefactor.range)) === i
    );
    return distinctPerFn;
  }
}
