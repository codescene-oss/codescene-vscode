import { Position } from 'vscode';
import { FileWithIssues } from '../code-health-monitor/file-with-issues';
import { Delta, FunctionFinding } from '../devtools-api/delta-model';
import { FnToRefactor } from '../devtools-api/refactor-models';
import { FileDeltaData, FileMetaType } from './types';
import type { DeltaForFile, FunctionFinding as CwfFunctionFinding, FunctionToRefactor } from './types/delta';

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * The webview type requires `function-type`, which the daemon leaves optional. The webview never reads it
 * (the refactoring itself runs from the extension's own FnToRefactor), so an absent one is sent as empty.
 */
function toCwfFunctionToRefactor(fn: FnToRefactor): FunctionToRefactor {
  return {
    name: fn.name,
    body: fn.body,
    'function-type': fn['function-type'] ?? '',
    'file-type': fn['file-type'],
    range: fn.range,
    'refactoring-targets': fn['refactoring-targets'],
  };
}

/**
 * The webview schemas are closed, so a finding carries exactly the fields the webview declares.
 * The extension keeps the refactorable function as `refactorableFn` (with internal fields such as `vscodeRange`);
 * the webview calls it `refactorable-fn`.
 */
function toCwfFunctionFinding(finding: FunctionFinding): CwfFunctionFinding {
  return {
    function: finding.function,
    'change-details': finding['change-details'],
    ...(finding.refactorableFn && { 'refactorable-fn': toCwfFunctionToRefactor(finding.refactorableFn) }),
  };
}

/**
 * Convert a delta result to the webview's DeltaForFile: only the fields the webview declares
 * (so not the blob SHAs of deltaReview results), with each function finding in the webview's shape.
 */
export function convertDeltaToCWFDelta(delta: Delta): DeltaForFile {
  return {
    ...(delta['old-score'] !== undefined && { 'old-score': delta['old-score'] }),
    ...(delta['new-score'] !== undefined && { 'new-score': delta['new-score'] }),
    'score-change': delta['score-change'],
    'file-level-findings': delta['file-level-findings'],
    'function-level-findings': delta['function-level-findings'].map(toCwfFunctionFinding),
  };
}

/**
 * Convert VSCode FileWithIssues to CWF delta object
 * @param event
 * @returns
 */
export function convertFileIssueToCWFDeltaItem(event: FileWithIssues): FileDeltaData {
  return {
    file: {
      fileName: event.document.fileName,
    },
    delta: convertDeltaToCWFDelta(event.deltaForFile),
  };
}

/**
 * Searches the native fileIssueMap for file and function to be able to get native objects needed (document + Position)
 * @param fileIssueMap
 * @param fileName
 * @param fn
 * @returns
 */
export function getFileAndFunctionFromState(
  fileIssueMap: Map<string, FileWithIssues>,
  fileName: string,
  fn?: { name: string; startLine: number }
) {
  const locatedFile = fileIssueMap.get(fileName);
  if (!locatedFile) return;

  const locatedFn = fn
    ? locatedFile.functionLevelIssues.find((functionLevelIssues) => fn.name === functionLevelIssues.fnName)
    : undefined;

  return {
    file: locatedFile,
    fn: locatedFn
      ? {
          fnName: locatedFn?.fnName,
        }
      : undefined,
    fnToRefactor: locatedFn?.fnToRefactor,
  };
}

/**
 * Convert webview fn range to a VSCode Position
 * @param fn
 * @returns
 */
export function getFunctionPosition(fn: FileMetaType['fn'] | undefined): Position | undefined {
  return fn?.range ? new Position(fn.range?.startLine - 1, fn.range?.startColumn - 1) : undefined;
}
