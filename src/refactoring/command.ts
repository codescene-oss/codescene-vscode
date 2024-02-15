import vscode, { TextDocument } from 'vscode';
import { findEnclosingFunction } from '../codescene-interop';
import { CsRestApi } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { isDefined } from '../utils';
import { CsRefactorCodeLensProvider } from './codelens';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';
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

export class CsRefactoringCommand {
  constructor(
    private context: vscode.ExtensionContext,
    private csRestApi: CsRestApi,
    private cliPath: string,
    private codeLensProvider: CsRefactorCodeLensProvider,
    private codeSmellFilter: (d: vscode.Diagnostic) => boolean,
    private maxInputLoc: number
  ) {}

  register() {
    const requestRefactoringCmd = vscode.commands.registerCommand(
      requestRefactoringsCmdName,
      this.requestRefactorings,
      this
    );
    this.context.subscriptions.push(requestRefactoringCmd);
    const presentRefactoringCmd = vscode.commands.registerCommand(
      presentRefactoringCmdName,
      this.presentRefactoringRequest,
      this
    );
    this.context.subscriptions.push(presentRefactoringCmd);
  }

  presentRefactoringRequest(refactoringRequest: CsRefactoringRequest) {
    if (!refactoringRequest.resolvedResponse) {
      logOutputChannel.warn('No response for this refactoring yet.');
      return;
    }

    RefactoringPanel.createOrShow({
      extensionUri: this.context.extensionUri,
      refactoringRequest,
    });
  }

  async requestRefactorings(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    const fnsToRefactor = await Promise.all(
      diagnostics
        .filter(this.codeSmellFilter)
        .map((d) => findFunctionToRefactor(this.cliPath, document, d.range, this.maxInputLoc))
    ).then((fns) => fns.filter(isDefined));

    const distinctFns = fnsToRefactor.filter((fn, i, fns) => fns.findIndex((f) => f.range.isEqual(fn.range)) === i);
    CsRefactoringRequests.initiate(
      { codeLensProvider: this.codeLensProvider, csRestApi: this.csRestApi, document: document },
      distinctFns,
      diagnostics
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

export function toConfidenceSymbol(confidenceLevel?: number) {
  switch (confidenceLevel) {
    case 3:
    case 2:
      return refactoringSymbol;
    case 1:
      return codeImprovementGuideSymbol;
    default:
      return; // Missing confidence level can indicate that we don't have the response, or that an error has occurred.
  }
}

export function commandFromLevel(confidenceLevel: number, request: CsRefactoringRequest) {
  let title = '';
  let command = presentRefactoringCmdName;
  const symbol = toConfidenceSymbol(confidenceLevel);
  switch (confidenceLevel) {
    case 3:
    case 2:
      title = `${symbol} Auto-refactor`;
      break;
    case 1:
      title = `${symbol} Improvement guide`;
      break;
    default:
      logOutputChannel.error(`Confidence level ${confidenceLevel} => no command`);
      return;
  }
  return { title, command, arguments: [request] };
}
