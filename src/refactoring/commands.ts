import vscode, { TextDocument } from 'vscode';
import { findEnclosingFunction } from '../codescene-interop';
import { CsRestApi, PreFlightResponse } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { DiagnosticFilter, isDefined } from '../utils';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';
import { RefactoringPanel } from './refactoring-panel';
import { createCodeSmellsFilter } from './utils';

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

export interface CsRefactoringCommandParams {
  context: vscode.ExtensionContext;
  csRestApi: CsRestApi;
  cliPath: string;
  codeSmellFilter: DiagnosticFilter;
  maxInputLoc: number;
}

export class CsRefactoringCommands {
  private extensionUri: vscode.Uri;
  constructor(
    context: vscode.ExtensionContext,
    private csRestApi: CsRestApi,
    private cliPath: string,
    private codeSmellFilter?: DiagnosticFilter,
    private maxInputLoc?: number
  ) {
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

  presentRefactoringRequest(refactoringRequest: CsRefactoringRequest) {
    if (refactoringRequest.isPending()) {
      logOutputChannel.warn('No response for this refactoring yet.');
      return;
    }

    RefactoringPanel.createOrShow({
      extensionUri: this.extensionUri,
      refactoringRequest,
    });
  }

  private isRequestRefactoringCmdEnabled() {
    return isDefined(this.codeSmellFilter) && isDefined(this.maxInputLoc);
  }

  enableRequestRefactoringsCmd(preflightResponse: PreFlightResponse) {
    this.codeSmellFilter = createCodeSmellsFilter(preflightResponse);
    this.maxInputLoc = preflightResponse['max-input-loc'];
  }

  disableRequestRefactoringsCmd() {
    this.codeSmellFilter = undefined;
    this.maxInputLoc = undefined;
  }

  async requestRefactorings(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    if (!this.isRequestRefactoringCmdEnabled()) return;

    const codeSmellFilter: DiagnosticFilter = this.codeSmellFilter as DiagnosticFilter;
    const maxInputLoc: number = this.maxInputLoc as number;

    const supportedDiagnostics = diagnostics.filter(codeSmellFilter);
    const fnsToRefactor = await Promise.all(
      supportedDiagnostics.map((d) => findFunctionToRefactor(this.cliPath, document, d.range, maxInputLoc))
    ).then((fns) => fns.filter(isDefined));

    const distinctFns = fnsToRefactor.filter((fn, i, fns) => fns.findIndex((f) => f.range.isEqual(fn.range)) === i);
    CsRefactoringRequests.initiate(
      { csRestApi: this.csRestApi, document: document },
      distinctFns,
      supportedDiagnostics
    );
  }
}

async function findFunctionToRefactor(
  cliPath: string,
  document: TextDocument,
  range: vscode.Range,
  maxInputLoc: number
) {
  const extension = document.fileName.split('.').pop() || '';
  const enclosingFn = await findEnclosingFunction(
    cliPath,
    extension,
    range.start.line + 1, // range.start.line is zero-based
    document.getText()
  );

  if (!enclosingFn) return;

  // Note that vscode.Range line numbers are zero-based
  const enclosingFnRange = new vscode.Range(
    enclosingFn['start-line'] - 1,
    enclosingFn['start-column'],
    enclosingFn['end-line'] - 1,
    enclosingFn['end-column']
  );

  const loc = enclosingFnRange.end.line - enclosingFnRange.start.line;
  if (loc > maxInputLoc) {
    logOutputChannel.info(`Function "${enclosingFn.name}" exceeds max-input-loc (${loc} > ${maxInputLoc}) - ignoring`);
    return;
  }

  return {
    name: enclosingFn.name,
    range: enclosingFnRange,
    functionType: enclosingFn['function-type'],
    'file-type': extension,
    content: document.getText(enclosingFnRange),
  } as FnToRefactor;
}
export const refactoringSymbol = '✨';
const codeImprovementGuideSymbol = '🧐';
export const pendingSymbol = '⏳';
const errorSymbol = '❌';

export function toConfidenceSymbol(request: CsRefactoringRequest) {
  if (isDefined(request.error)) return errorSymbol;

  switch (request.resolvedResponse?.confidence.level) {
    case 3:
    case 2:
      return refactoringSymbol;
    case 1:
      return codeImprovementGuideSymbol;
    default:
      return pendingSymbol;
  }
}

export function commandFromRequest(request: CsRefactoringRequest) {
  if (request.isPending() || !request.shouldPresent()) {
    return; // No command for pending requests or invalid confidence levels
  }

  let title = '';
  let command = presentRefactoringCmdName;
  const symbol = toConfidenceSymbol(request);
  const level = request.resolvedResponse?.confidence.level;
  switch (level) {
    case 3:
    case 2:
      title = `${symbol} Auto-refactor`;
      break;
    case 1:
      title = `${symbol} Improvement guide`;
      break;
    default:
      title = `${symbol} Auto-refactor`; // errors
      break;
  }
  return { title, command, arguments: [request] };
}
