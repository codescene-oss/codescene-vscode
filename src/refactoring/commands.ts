import vscode, { Position, Range, Selection, TextEditorRevealType, ViewColumn, WorkspaceEdit } from 'vscode';
import { EnclosingFn, findEnclosingFunctions } from '../codescene-interop';
import { CodeSceneTabPanel } from '../codescene-tab/webViewPanel';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { logOutputChannel } from '../log';
import Telemetry from '../telemetry';
import { isDefined, registerCommandWithTelemetry } from '../utils';
import { RefactoringCapabilities } from './capabilities';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';
import { createTempDocument, decorateCode, targetEditor } from './utils';

export interface FnToRefactor {
  name: string;
  range: vscode.Range;
  content: string;
  filePath: string;
  functionType: string;
  codeSmells: FnCodeSmell[];
}

interface FnCodeSmell {
  category: string;
  relativeStartLine: number;
  relativeEndLine: number;
}

export interface RefactoringTarget {
  line: number; // 1-indexed line numbers (from Devtools API)
  category: string;
}

export class CsRefactoringCommands implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private capabilities: RefactoringCapabilities) {
    capabilities.documentSelector;

    this.disposables.push(
      vscode.commands.registerCommand('codescene.requestRefactorings', this.requestRefactoringsCmd, this),
      registerCommandWithTelemetry({
        commandId: 'codescene.presentRefactoring',
        handler: this.presentRefactoringRequestCmd,
        thisArg: this,
        logArgs: (request?: CsRefactoringRequest) => ({ 'trace-id': request?.traceId }),
      }),
      vscode.commands.registerCommand('codescene.getFunctionToRefactor', this.getFunctionToRefactorCmd, this),
      vscode.commands.registerCommand(
        'codescene.initiateRefactoringForFunction',
        this.initiateRefactoringForFunction,
        this
      ),
      vscode.commands.registerCommand('codescene.applyRefactoring', this.applyRefactoringCmd, this),
      vscode.commands.registerCommand('codescene.showDiffForRefactoring', this.showDiffForRefactoringCmd, this)
    );
  }

  private presentRefactoringRequestCmd(request?: CsRefactoringRequest) {
    if (!request) return;
    CodeSceneTabPanel.show({ params: request });
  }

  private async requestRefactoringsCmd(document: vscode.TextDocument, refactoringTargets: RefactoringTarget[]) {
    const distinctFns = await this.supportedDistinctFnsToRefactor(document, refactoringTargets);
    if (!distinctFns) return;
    return CsRefactoringRequests.initiate(document, distinctFns);
  }

  private async getFunctionToRefactorCmd(document: vscode.TextDocument, refactoringTargets: RefactoringTarget[]) {
    const distinctFns = await this.supportedDistinctFnsToRefactor(document, refactoringTargets);
    return distinctFns?.[0];
  }

  private async supportedDistinctFnsToRefactor(document: vscode.TextDocument, refactoringTargets: RefactoringTarget[]) {
    if (vscode.languages.match(this.capabilities.documentSelector, document) === 0) return;
    return await this.findFunctionsToRefactor(document, refactoringTargets);
  }

  private initiateRefactoringForFunction(document: vscode.TextDocument, fnToRefactor: FnToRefactor) {
    if (vscode.languages.match(this.capabilities.documentSelector, document) === 0) return;
    const requests = CsRefactoringRequests.initiate(document, [fnToRefactor]);
    return requests[0];
  }

  private async findFunctionsToRefactor(document: vscode.TextDocument, refactoringTargets: RefactoringTarget[]) {
    const supportedTargets = refactoringTargets.filter((d: RefactoringTarget) =>
      this.capabilities.isSupported(d.category, document)
    );

    const distinctSupportedLines = new Set(supportedTargets.map((d: RefactoringTarget) => d.line));
    const enclosingFns = await findEnclosingFunctions(
      document.fileName,
      [...distinctSupportedLines],
      document.getText()
    );

    const maxInputLoc = this.capabilities.maxLocFor(document);
    return enclosingFns
      .filter((enclosingFn) => {
        const activeLoc = enclosingFn['active-code-size'];
        if (activeLoc <= maxInputLoc) return true;
        logOutputChannel.debug(
          `Function "${enclosingFn.name}" exceeds max-input-loc (${activeLoc} > ${maxInputLoc}) - ignoring`
        );
        return false;
      })
      .map((enclosingFn) => toFnToRefactor(enclosingFn, document, supportedTargets))
      .sort((a, b) => linesOfCode(a.range) - linesOfCode(b.range));
  }

  private async applyRefactoringCmd(refactoring: CsRefactoringRequest) {
    const {
      document,
      fnToRefactor,
      fnToRefactor: { range },
    } = refactoring;

    return refactoring.promise.then(async (response) => {
      const { level } = response.confidence;
      if (level < 2) {
        throw new Error(
          `Don't apply refactoring for function "${fnToRefactor.name}" - confidence level too low (${response.confidence}).`
        );
      }
      const workSpaceEdit = new WorkspaceEdit();
      workSpaceEdit.replace(document.uri, range, response.code);
      await vscode.workspace.applyEdit(workSpaceEdit);
      // Select the replaced code in the editor, starting from the original position
      void selectCode(document, response.code, range.start);

      // Immediately trigger a re-review of the new file-content
      // This is important, since otherwise the review is controlled by the debounced review done in the onDidChangeTextDocument (extension.ts)
      CsDiagnostics.review(document);
      Telemetry.instance.logUsage('refactor/applied', { 'trace-id': refactoring.traceId });
    });
  }

  private async showDiffForRefactoringCmd(refactoring: CsRefactoringRequest) {
    const {
      document,
      fnToRefactor: { range },
    } = refactoring;

    const response = await refactoring.promise;
    const decoratedCode = decorateCode(response, document.languageId);
    // Create temporary virtual documents to use in the diff command. Just opening a new document with the new code
    // imposes a save dialog on the user when closing the diff.
    const originalCodeTmpDoc = await createTempDocument('Original', {
      content: document.getText(range),
      languageId: document.languageId,
    });
    const refactoringTmpDoc = await createTempDocument('Refactoring', {
      content: decoratedCode,
      languageId: document.languageId,
    });

    // Use showTextDocument using the tmp doc and the target editor view column to set that editor active.
    // The diff command will then open in that same viewColumn, and not on top of the ACE panel.
    const editor = targetEditor(document);
    await vscode.window.showTextDocument(originalCodeTmpDoc, editor?.viewColumn, false);
    await vscode.commands.executeCommand('vscode.diff', originalCodeTmpDoc.uri, refactoringTmpDoc.uri);

    Telemetry.instance.logUsage('refactor/diff-shown', { 'trace-id': refactoring.traceId });
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

function rangeFromCode(position: Position, code: string) {
  const lines = code.split(/\r\n|\r|\n/);
  const lineDelta = lines.length - 1;
  const characterDelta = lines[lines.length - 1].length;
  return new Range(position, position.translate({ lineDelta, characterDelta }));
}

/**
 * Opens the document if not already opened, and selects the code at a position in the
 * editor containing the document
 */
async function selectCode(document: vscode.TextDocument, code: string, position: vscode.Position) {
  const newRange = rangeFromCode(position, code);
  const editor =
    targetEditor(document) ||
    (await vscode.window.showTextDocument(document.uri, {
      preview: false,
      viewColumn: ViewColumn.One,
    }));
  editor.selection = new Selection(newRange.start, newRange.end);
  editor.revealRange(newRange, TextEditorRevealType.InCenterIfOutsideViewport);
}

function linesOfCode(range: vscode.Range) {
  // Maybe evident, but worth noting that function with a single line has a loc of 1 :)
  return range.end.line - range.start.line + 1;
}

function toFnToRefactor(
  enclosingFn: EnclosingFn,
  document: vscode.TextDocument,
  refactoringTargets: RefactoringTarget[]
) {
  const range = rangeFromEnclosingFn(enclosingFn);
  const codeSmells = targetsInRange(refactoringTargets, range);
  return {
    name: enclosingFn.name,
    range,
    functionType: enclosingFn['function-type'],
    filePath: document.fileName,
    content: document.getText(range),
    codeSmells,
  } as FnToRefactor;
}

export function targetsInRange(refactoringTargets: RefactoringTarget[], fnRange: vscode.Range) {
  return refactoringTargets
    .filter((target) => target.line >= fnRange.start.line + 1 && target.line <= fnRange.end.line + 1)
    .map((target) => {
      return {
        category: target.category,
        relativeStartLine: target.line - (fnRange.start.line + 1),
        relativeEndLine: fnRange.end.line + 1 - target.line,
      } as FnCodeSmell;
    });
}

// Note that vscode.Range line numbers are zero-based, while the CodeScene API uses 1-based line numbers
export function rangeFromEnclosingFn(enclosingFn: EnclosingFn) {
  return new vscode.Range(
    enclosingFn['start-line'] - 1,
    enclosingFn['start-column'],
    enclosingFn['end-line'] - 1,
    enclosingFn['end-column']
  );
}

export const refactoringSymbol = '✨';
const codeImprovementGuideSymbol = '🧐';
export const pendingSymbol = '⏳';

export function toConfidenceSymbol(level?: number) {
  if (!isDefined(level)) return pendingSymbol;
  if (level > 1) {
    return refactoringSymbol;
  } else if (level === 1) {
    return codeImprovementGuideSymbol;
  }
}
