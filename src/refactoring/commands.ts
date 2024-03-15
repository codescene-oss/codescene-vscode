import vscode from 'vscode';
import { findEnclosingFunction } from '../codescene-interop';
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
    const maxInputLoc = this.commandProps.maxInputLoc;
    const fnsToRefactor = await Promise.all(
      supportedDiagnostics.map((d) => findFunctionToRefactor(this.cliPath, document, d.range, maxInputLoc))
    ).then((fns) => fns.filter(isDefined));

    const distinctFns = fnsToRefactor.filter((fn, i, fns) => fns.findIndex((f) => f.range.isEqual(fn.range)) === i);
    CsRefactoringRequests.initiate(document, distinctFns, supportedDiagnostics);
  }
}

async function findFunctionToRefactor(
  cliPath: string,
  document: vscode.TextDocument,
  range: vscode.Range,
  maxInputLoc: number
) {
  const extension = getFileExtension(document.fileName);
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

export function toConfidenceSymbol(level?: number) {
  switch (level) {
    case 3:
    case 2:
      return refactoringSymbol;
    case 1:
      return codeImprovementGuideSymbol;
    default:
      return pendingSymbol;
  }
}

export function commandFromRequest(request: ResolvedRefactoring): vscode.Command | undefined {
  if (!validConfidenceLevel(request.response.confidence.level)) {
    return; // No command for invalid confidence levels
  }

  let title = '';
  let command = presentRefactoringCmdName;
  const symbol = toConfidenceSymbol(request.response.confidence.level);
  const level = request.response?.confidence.level;
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
