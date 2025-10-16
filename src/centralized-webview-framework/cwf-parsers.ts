import { Position } from 'vscode';
import { Baseline } from '../cs-extension-state';
import { FileWithIssues } from '../code-health-monitor/tree-model';
import { FileDeltaData, FileMetaType } from './types';
import { CommitBaselineType } from './types/messages';

/**
 * Convert VSCode commit baseline enum to CWF baseline string
 */
export function convertVSCodeCommitBaselineToCWF(baseline: Baseline): CommitBaselineType {
  const payloadConverter: CommitBaselineType[] = ['HEAD', 'branchCreate', 'default'];
  return payloadConverter[baseline - 1];
}

/**
 * Convert CWF basleinetring to VSCode enum
 * @param commitBaselineString
 * @returns
 */
export function convertCWFCommitBaselineToVSCode(commitBaselineString: CommitBaselineType) {
  const payloadConverter = {
    HEAD: 1,
    branchCreate: 2,
    default: 3,
  };
  return payloadConverter[commitBaselineString];
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
  return fn?.range ? new Position(fn.range?.startLine, fn.range?.startColumn) : undefined;
}
