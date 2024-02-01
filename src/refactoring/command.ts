import vscode, { TextDocument, window } from 'vscode';
import { findEnclosingFunction } from '../codescene-interop';
import { CsRestApi, RefactorResponse } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { isDefined } from '../utils';
import { CsRefactorCodeLensProvider } from './codelens';
import { CsRefactoringRequest, CsRefactoringRequests } from './cs-refactoring-requests';
import { RefactoringPanel } from './refactoring-panel';

export const requestRefactoringsCmdName = 'codescene.requestRefactorings';
export const showRefactoringCmdName = 'codescene.showRefactoring';

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
    const showRefactoringCmd = vscode.commands.registerCommand(showRefactoringCmdName, this.showRefactoring, this);
    this.context.subscriptions.push(showRefactoringCmd);
  }

  showRefactoring(document: vscode.TextDocument, fnToRefactor: FnToRefactor, refactorResponse: RefactorResponse) {
    const editor = window.activeTextEditor;
    if (editor) {
      editor.selection = new vscode.Selection(fnToRefactor.range.start, fnToRefactor.range.end);
      editor.revealRange(fnToRefactor.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    const initiatorViewColumn = editor?.viewColumn;

    RefactoringPanel.createOrShow({
      extensionUri: this.context.extensionUri,
      document,
      initiatorViewColumn,
      fnToRefactor,
      response: refactorResponse,
    });
  }

  async requestRefactorings(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]) {
    const fnsToRefactor = await Promise.all(
      diagnostics
        .filter(this.codeSmellFilter)
        .map((d) => findFunctionToRefactor(this.cliPath, document, d.range, this.maxInputLoc))
    ).then((fns) => fns.filter(isDefined));

    const distinctFns = fnsToRefactor.filter((fn, i, fns) => fns.findIndex((f) => f.range.isEqual(fn.range)) === i);
    distinctFns.forEach(async (fn) => {
      const diagnosticsForFn = diagnostics.filter((d) => fn.range.contains(d.range));
      const req = new CsRefactoringRequest(this.csRestApi, this.codeLensProvider, diagnosticsForFn, fn);
      diagnosticsForFn.forEach((d) => {
        // Save the request for each diagnostic for easy access in codelens and codeaction providers
        CsRefactoringRequests.set(document, d, req);
      });
    });
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
    logOutputChannel.warn(`Function "${enclosingFn.name}" exceeds max-input-loc (${loc} > ${maxInputLoc})`);
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

interface ShowRefactoringArgs {
  document: vscode.TextDocument;
  fnToRefactor: FnToRefactor;
  refactorResponse: RefactorResponse;
}

export function commandFromLevel(confidenceLevel: number, args: ShowRefactoringArgs) {
  let title = '';
  let command = '';
  switch (confidenceLevel) {
    case 3:
    case 2:
      title = `✨ Auto-refactor`;
      command = showRefactoringCmdName;
      break;
    case 1:
      title = `🧐 Improvement guide`;
      command = showRefactoringCmdName;
      break;
    default:
      logOutputChannel.error(`Confidence level ${confidenceLevel} => no command`);
      return;
  }
  return { title, command, arguments: [args.document, args.fnToRefactor, args.refactorResponse] };
}
