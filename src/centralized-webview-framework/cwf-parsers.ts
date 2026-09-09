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

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Convert docsType format to something the old docsPanel can understand
 * "docs_issues_complex_method" => "Complex Method"
 * @param docType
 * @returns
 */
export function convertCWFDocTypeToVSCode(docType: string) {
  return capitalize(docType.replace('docs_', '').replace('issues_', '').replace(/_/g, ' '));
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
