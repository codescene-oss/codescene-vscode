import vscode, { Diagnostic } from 'vscode';
import { EnclosingFn, findEnclosingFunctions } from '../codescene-interop';
import { logOutputChannel } from '../log';
import { getCsDiagnosticCode } from '../review/utils';
import { isDefined, registerCommandWithTelemetry } from '../utils';
import { toRefactoringDocumentSelector } from './addon';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';
import { PreFlightResponse } from './model';
import { RefactoringPanel } from './refactoring-panel';

export interface FnToRefactor {
  name: string;
  range: vscode.Range;
  content: string;
  fileName: string;
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
  private extensionUri: vscode.Uri;
  private documentSelector: vscode.DocumentSelector;

  constructor(extensionUri: vscode.Uri, private preflightResponse: PreFlightResponse) {
    this.extensionUri = extensionUri;
    this.documentSelector = toRefactoringDocumentSelector(preflightResponse.supported['file-types']);

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
      )
    );
  }

  private presentRefactoringRequestCmd(request?: CsRefactoringRequest, viewColumn?: vscode.ViewColumn) {
    if (!request) return;
    RefactoringPanel.createOrShow({
      extensionUri: this.extensionUri,
      refactoring: request,
      viewColumn,
    });
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
    if (vscode.languages.match(this.documentSelector, document) === 0) return;
    return await this.findFunctionsToRefactor(document, refactoringTargets);
  }

  private initiateRefactoringForFunction(document: vscode.TextDocument, fnToRefactor: FnToRefactor) {
    if (vscode.languages.match(this.documentSelector, document) === 0) return;
    const requests = CsRefactoringRequests.initiate(document, [fnToRefactor]);
    return requests[0];
  }

  private async findFunctionsToRefactor(document: vscode.TextDocument, refactoringTargets: RefactoringTarget[]) {
    const supportedTargets = refactoringTargets.filter((d: RefactoringTarget) =>
      this.preflightResponse.supported['code-smells'].includes(d.category)
    );

    const distinctSupportedLines = new Set(supportedTargets.map((d: RefactoringTarget) => d.line));
    const enclosingFns = await findEnclosingFunctions(
      document.fileName,
      [...distinctSupportedLines],
      document.getText()
    );

    const maxInputLoc = this.preflightResponse['max-input-loc'];
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

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
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
    fileName: document.fileName,
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
