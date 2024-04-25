import * as vscode from 'vscode';
import { reviewDocumentSelector } from '../language-support';
import { logOutputChannel } from '../log';
import Reviewer from '../review/reviewer';
import { isDefined } from '../utils';
import { pendingSymbol, presentRefactoringCmdName, toConfidenceSymbol } from './commands';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';

export class RefactoringsView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: RefactoringsTreeProvider;
  private view: vscode.TreeView<CsRefactoringRequest | ReviewStatus>;

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
        if (e === 'reviewing') return; // Important to not try and await the scorePresentation below if we know a review is running

        if (isDefined(this.treeDataProvider.activeDocument)) {
          const scorePresentation = await Reviewer.instance.review(this.treeDataProvider.activeDocument)
            .scorePresentation;
          // Add short code health score to the view description
          this.view.description = `${fileName} (score: ${scorePresentation})`;
        }
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand('codescene.gotoAndPresentRefactoring', this.gotoAndPresentRefactoring, this)
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

    void vscode.commands.executeCommand(
      'editor.action.goToLocations',
      response.document.uri,
      response.fnToRefactor.range.start,
      [new vscode.Location(response.document.uri, response.fnToRefactor.range)]
    );

    void vscode.commands.executeCommand(presentRefactoringCmdName, response);
  }

  dispose() {
    this.treeDataProvider.dispose(); // Dispose and clear the treedataprovider first, emptying the view
    this.view.description = ''; // Don't leave a trailing description when disposing the view

    this.disposables.forEach((d) => d.dispose());
  }
}

type ReviewStatus = 'reviewing' | 'done';

class RefactoringsTreeProvider
  implements vscode.TreeDataProvider<CsRefactoringRequest | ReviewStatus>, vscode.Disposable
{
  private disposables: vscode.Disposable[] = [];
  private treeDataChangedEmitter = new vscode.EventEmitter<CsRefactoringRequest | ReviewStatus | void>();
  readonly onDidChangeTreeData = this.treeDataChangedEmitter.event;
  private readonly documentSelector: vscode.DocumentSelector;

  private documentsInReview: Map<string, ReviewStatus> = new Map();
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

    const reviewListenerDisposable = Reviewer.instance.onDidReview((e) => {
      if (!e.document) return;
      if (e.type === 'reviewstart') {
        this.documentsInReview.set(e.document?.fileName, 'reviewing');
        this.treeDataChangedEmitter.fire('reviewing');
      } else if (e.type === 'reviewend') {
        this.documentsInReview.set(e.document?.fileName, 'done');
        this.treeDataChangedEmitter.fire('done');
      }
    });
    this.disposables.push(reviewListenerDisposable);
  }

  private validEditorDoc(e: vscode.TextEditor | undefined) {
    if (isDefined(e) && vscode.languages.match(this.documentSelector, e.document) !== 0) return e.document;
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

  getTreeItem(childElement: CsRefactoringRequest | ReviewStatus): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (!(childElement instanceof CsRefactoringRequest)) {
      return new vscode.TreeItem('⏳ Code review in progress...', vscode.TreeItemCollapsibleState.None);
    }

    const toString = (request: CsRefactoringRequest) => {
      const range = request.fnToRefactor.range;
      const symbol = toConfidenceSymbol(request.response?.confidence.level);
      return `${symbol || pendingSymbol} "${request.fnToRefactor.name}" [Ln ${range.start.line + 1}, Col ${
        range.start.character
      }]`;
    };
    const item = new vscode.TreeItem(toString(childElement), vscode.TreeItemCollapsibleState.None);
    item.tooltip = `Click to go to location in ${childElement.document.fileName.split('/').pop()}`;

    const location = new vscode.Location(childElement.document.uri, childElement.fnToRefactor.range);
    item.command = {
      command: 'editor.action.goToLocations',
      title: 'Go To Location(s)',
      arguments: [childElement.document.uri, childElement.fnToRefactor.range.start, [location]],
    };
    return item;
  }

  getChildren(
    element?: CsRefactoringRequest | ReviewStatus | undefined
  ): vscode.ProviderResult<CsRefactoringRequest[] | ReviewStatus[]> {
    if (element || !this.activeDocument) {
      return [];
    }

    if (this.documentsInReview.get(this.activeDocument.fileName) !== 'done') return ['reviewing'];

    const requestsForActiveDoc = CsRefactoringRequests.getAll(this.activeDocument);
    const presentableRefactoring = requestsForActiveDoc.filter((r) => r.shouldPresent());
    const distinctPerFn = presentableRefactoring.filter(
      (r, i, rs) => rs.findIndex((rr) => rr.traceId === r.traceId) === i
    );
    return distinctPerFn.sort((a, b) => a.fnToRefactor.range.start.line - b.fnToRefactor.range.start.line);
  }
}
