import vscode from 'vscode';
import { EnclosingFn, findEnclosingFunctions } from '../codescene-interop';
import { logOutputChannel } from '../log';
import { DiagnosticFilter, getFileExtension, isDefined } from '../utils';
import { CsRefactoringRequests, ResolvedRefactoring, validConfidenceLevel } from './cs-refactoring-requests';
import { PreFlightResponse } from './model';
import { RefactoringPanel } from './refactoring-panel';

export const requestRefactoringsCmdName = 'codescene.requestRefactorings';
export const presentRefactoringCmdName = 'codescene.presentRefactoring';

export interface FnToRefactor {
  name: string;
  range: vscode.Range;
  content: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'file-type': string;
  functionType: string;
}

export class CsRefactoringCommands implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private extensionUri: vscode.Uri;

  constructor(
    extensionUri: vscode.Uri,
    private cliPath: string,
    private documentSelector: vscode.DocumentSelector,
    private codeSmellFilter: DiagnosticFilter,
    private maxInputLoc: number
  ) {
    this.extensionUri = extensionUri;
    const requestRefactoringCmd = vscode.commands.registerCommand(
      requestRefactoringsCmdName,
      this.requestRefactorings,
      this
    );
    this.disposables.push(requestRefactoringCmd);

    const presentRefactoringCmd = vscode.commands.registerCommand(
      presentRefactoringCmdName,
      this.presentRefactoringRequest,
      this
    );
    this.disposables.push(presentRefactoringCmd);
  }

  private presentRefactoringRequest(refactoring: ResolvedRefactoring) {
    RefactoringPanel.createOrShow({
      extensionUri: this.extensionUri,
      refactoring,
    });
  }

  private async requestRefactorings(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    if (vscode.languages.match(this.documentSelector, document) === 0) return;
    const supportedDiagnostics = diagnostics.filter(this.codeSmellFilter);

    const distinctFns = await this.distinctFnsFromDiagnostics(document, supportedDiagnostics, this.maxInputLoc);

    const fnsToRefactor = distinctFns.slice(0, 10);
    CsRefactoringRequests.initiate(document, fnsToRefactor, supportedDiagnostics);
  }

  private async distinctFnsFromDiagnostics(
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
    maxInputLoc: number
  ) {
    // Get distinct ranges so we don't have to run findFunctionToRefactor for the same range multiple times
    const distinctRanges = diagnostics
      .filter((diag, i, diags) => diags.findIndex((d) => d.range.isEqual(diag.range)) === i)
      .map((d) => d.range);

    return await findFunctionsToRefactor(this.cliPath, document, distinctRanges, maxInputLoc);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

async function findFunctionsToRefactor(
  cliPath: string,
  document: vscode.TextDocument,
  ranges: vscode.Range[],
  maxInputLoc: number
) {
  const extension = getFileExtension(document.fileName);
  const lineNumbers = ranges.map((r) => r.start.line + 1); // range.start.line is zero-based
  const enclosingFns = await findEnclosingFunctions(cliPath, extension, lineNumbers, document.getText());

  return enclosingFns
    .map((enclosingFn) => toFnToRefactor(enclosingFn, document, extension, maxInputLoc))
    .filter(isDefined)
    .sort((a, b) => loc(a.range) - loc(b.range));
}

function loc(range: vscode.Range) {
  // Maybe evident, but worth noting that function with a single line has a loc of 1 :)
  return range.end.line - range.start.line + 1;
}

function toFnToRefactor(
  enclosingFn: EnclosingFn,
  document: vscode.TextDocument,
  extension: string,
  maxInputLoc: number
) {
  const activeLoc = enclosingFn['active-code-size'];
  const range = rangeFromEnclosingFn(enclosingFn);
  if (activeLoc > maxInputLoc) {
    logOutputChannel.debug(
      `Function "${enclosingFn.name}" exceeds max-input-loc (${activeLoc} > ${maxInputLoc}) - ignoring`
    );
    return;
  }

  return {
    name: enclosingFn.name,
    range: range,
    functionType: enclosingFn['function-type'],
    'file-type': extension,
    content: document.getText(range),
  } as FnToRefactor;
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

export function commandFromRequest(request: ResolvedRefactoring): vscode.Command | undefined {
  if (!validConfidenceLevel(request.response.confidence.level)) {
    return; // No command for invalid confidence levels
  }

  let title = '';
  let command = presentRefactoringCmdName;
  const symbol = toConfidenceSymbol(request.response.confidence.level);
  const level = request.response.confidence.level;
  if (level > 1) {
    title = `${symbol} Auto-refactor`;
  } else if (level === 1) {
    title = `${symbol} Improvement guide`;
  }
  return { title, command, arguments: [request] };
}
