import vscode, { ViewColumn } from 'vscode';
import { EnclosingFn, findEnclosingFunctions } from '../codescene-interop';
import { logOutputChannel } from '../log';
import { getCsDiagnosticCode } from '../review/utils';
import { getFileExtension, isDefined, registerCommandWithTelemetry } from '../utils';
import { toRefactoringDocumentSelector } from './addon';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';
import { PreFlightResponse } from './model';
import { RefactoringPanel } from './refactoring-panel';

export interface FnToRefactor {
  name: string;
  range: vscode.Range;
  content: string;
  fileType: string;
  functionType: string;
  codeSmells: FnCodeSmell[];
}

interface FnCodeSmell {
  category: string;
  relativeStartLine: number;
  relativeEndLine: number;
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
        logArgs: (request?: CsRefactoringRequest) => ({ "trace-id": request?.traceId }),
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

  private async requestRefactoringsCmd(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    const distinctFns = await this.supportedDistinctFnsToRefactor(document, diagnostics);
    if (!distinctFns) return;
    return CsRefactoringRequests.initiate(document, distinctFns);
  }

  private async getFunctionToRefactorCmd(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    const distinctFns = await this.supportedDistinctFnsToRefactor(document, diagnostics);
    return distinctFns?.[0];
  }

  private async supportedDistinctFnsToRefactor(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    if (vscode.languages.match(this.documentSelector, document) === 0) return;
    return await this.findFunctionsToRefactor(document, diagnostics);
  }

  private initiateRefactoringForFunction(document: vscode.TextDocument, fnToRefactor: FnToRefactor) {
    if (vscode.languages.match(this.documentSelector, document) === 0) return;
    const requests = CsRefactoringRequests.initiate(document, [fnToRefactor]);
    return requests[0];
  }

  private async findFunctionsToRefactor(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    const maxInputLoc = this.preflightResponse['max-input-loc'];

    // Filter diagnostics that are currently supported by ACE
    const supported = this.supportedDiagnostics(diagnostics);

    // Get distinct ranges so we don't have to run findFunctionToRefactor for the same range multiple times
    const distinctRanges = supported
      .filter((diag, i, diags) => diags.findIndex((d) => d.range.isEqual(diag.range)) === i)
      .map((d) => d.range);

    const extension = getFileExtension(document.fileName);
    const lineNumbers = distinctRanges.map((r) => r.start.line + 1); // range.start.line is zero-based
    const enclosingFns = await findEnclosingFunctions(extension, lineNumbers, document.getText());

    return enclosingFns
      .filter((enclosingFn) => {
        const activeLoc = enclosingFn['active-code-size'];
        if (activeLoc <= maxInputLoc) return true;
        logOutputChannel.debug(
          `Function "${enclosingFn.name}" exceeds max-input-loc (${activeLoc} > ${maxInputLoc}) - ignoring`
        );
        return false;
      })
      .map((enclosingFn) => toFnToRefactor(enclosingFn, document, extension, supported))
      .sort((a, b) => linesOfCode(a.range) - linesOfCode(b.range));
  }

  private supportedDiagnostics(diagnostics: vscode.Diagnostic[]) {
    return diagnostics.filter((d: vscode.Diagnostic) => {
      if (typeof d.code === 'string') return this.preflightResponse.supported['code-smells'].includes(d.code);
      if (typeof d.code === 'object') {
        return this.preflightResponse.supported['code-smells'].includes(d.code.value.toString());
      }
    });
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
  extension: string,
  supportedDiagnostics: vscode.Diagnostic[]
) {
  const codeSmells: FnCodeSmell[] = supportedDiagnostics
    .map((d) => {
      const category = getCsDiagnosticCode(d.code);
      if (!category) return;
      return {
        category,
        relativeStartLine: d.range.start.line - enclosingFn['start-line'],
        relativeEndLine: d.range.end.line - enclosingFn['start-line'],
      };
    })
    .filter(isDefined);

  const range = rangeFromEnclosingFn(enclosingFn);
  return {
    name: enclosingFn.name,
    range,
    functionType: enclosingFn['function-type'],
    fileType: extension,
    content: document.getText(range),
    codeSmells,
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
