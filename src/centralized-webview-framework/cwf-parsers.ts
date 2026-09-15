import { Position } from 'vscode';
import { FileWithIssues } from '../code-health-monitor/file-with-issues';
import { FileDeltaData, FileMetaType } from './types';

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
    delta: event.deltaForFile,
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
