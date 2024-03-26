import vscode from 'vscode';
import { EnclosingFn, findEnclosingFunctions } from '../codescene-interop';
import { toRefactoringDocumentSelector } from '../language-support';
import { logOutputChannel } from '../log';
import { DiagnosticFilter, getFileExtension, isDefined } from '../utils';
import { CsRefactoringRequests, ResolvedRefactoring, validConfidenceLevel } from './cs-refactoring-requests';
import { RefactoringPanel } from './refactoring-panel';
import { createCodeSmellsFilter } from './utils';
import { PreFlightResponse } from './model';

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

interface RefactoringCommandProps {
  documentSelector: vscode.DocumentSelector;
  codeSmellFilter: DiagnosticFilter;
  maxInputLoc: number;
}

export class CsRefactoringCommands {
  private extensionUri: vscode.Uri;
  private commandProps?: RefactoringCommandProps;

  constructor(context: vscode.ExtensionContext, private cliPath: string) {
    this.extensionUri = context.extensionUri;
    const requestRefactoringCmd = vscode.commands.registerCommand(
      requestRefactoringsCmdName,
      this.requestRefactorings,
      this
    );
    context.subscriptions.push(requestRefactoringCmd);
    const presentRefactoringCmd = vscode.commands.registerCommand(
      presentRefactoringCmdName,
      this.presentRefactoringRequest,
      this
    );
    context.subscriptions.push(presentRefactoringCmd);
  }

  presentRefactoringRequest(refactoring: ResolvedRefactoring) {
    RefactoringPanel.createOrShow({
      extensionUri: this.extensionUri,
      refactoring,
    });
  }

  enableRequestRefactoringsCmd(preflightResponse: PreFlightResponse) {
    this.commandProps = {
      documentSelector: toRefactoringDocumentSelector(preflightResponse.supported['file-types']),
      codeSmellFilter: createCodeSmellsFilter(preflightResponse),
      maxInputLoc: preflightResponse['max-input-loc'],
    };
  }

  disableRequestRefactoringsCmd() {
    this.commandProps = undefined;
  }

  async requestRefactorings(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    if (!isDefined(this.commandProps)) return;
    if (vscode.languages.match(this.commandProps.documentSelector, document) === 0) return;
    const supportedDiagnostics = diagnostics.filter(this.commandProps.codeSmellFilter);

    const distinctFns = await this.distinctFnsFromDiagnostics(
      document,
      supportedDiagnostics,
      this.commandProps.maxInputLoc
    );

    CsRefactoringRequests.initiate(document, distinctFns, supportedDiagnostics);
  }

  async distinctFnsFromDiagnostics(
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
    .filter(isDefined);
}

function toFnToRefactor(
  enclosingFn: EnclosingFn,
  document: vscode.TextDocument,
  extension: string,
  maxInputLoc: number
) {
  const { range, loc } = rangeAndLocFromEnclosingFn(enclosingFn);
  if (loc > maxInputLoc) {
    logOutputChannel.debug(`Function "${enclosingFn.name}" exceeds max-input-loc (${loc} > ${maxInputLoc}) - ignoring`);
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
export function rangeAndLocFromEnclosingFn(enclosingFn: EnclosingFn) {
  const range = new vscode.Range(
    enclosingFn['start-line'] - 1,
    enclosingFn['start-column'],
    enclosingFn['end-line'] - 1,
    enclosingFn['end-column']
  );
  // Maybe evident, but worth noting that function with a single line has a loc of 1 :)
  return { range, loc: range.end.line - range.start.line + 1 };
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
