import { Position } from 'vscode';
import { Baseline } from '../cs-extension-state';
import { FileWithIssues } from '../code-health-monitor/file-with-issues';
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
  // Clone the delta to avoid mutating the original
  const enrichedDelta = { ...event.deltaForFile };

  // Enrich function-level-findings with computed codeSmell data for webview consumption
  // The webview looks for finding['refactorable-fn'] to determine if Auto-Refactor button should render
  if (enrichedDelta['function-level-findings'] && event.functionLevelIssues) {
    enrichedDelta['function-level-findings'] = enrichedDelta['function-level-findings'].map((finding) => {
      // Find the corresponding DeltaFunctionInfo with locally-computed codeSmell
      const functionInfo = event.functionLevelIssues.find((fi) => fi.fnName === finding.function.name);

      if (functionInfo?.codeSmell) {
        // Inject refactorable-fn marker for webview to detect
        return {
          ...finding,
          'refactorable-fn': {
            name: finding.function.name || '',
            body: '', // Not needed for agentic refactoring
            'function-type': '', // Not needed for agentic refactoring
            'file-type': '', // Not needed for agentic refactoring
            range: finding.function.range || { 'start-line': 0, 'start-column': 0, 'end-line': 0, 'end-column': 0 },
            'refactoring-targets': [{
              category: functionInfo.codeSmell.category,
              line: functionInfo.codeSmell['highlight-range']['start-line'],
            }],
          },
        };
      }
      return finding;
    });
  }

  return {
    file: {
      fileName: event.document.fileName,
    },
    delta: enrichedDelta,
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
          codeSmell: locatedFn.codeSmell
            ? {
                category: locatedFn.codeSmell.category,
                details: locatedFn.codeSmell.details,
                highlightRange: {
                  startLine: locatedFn.codeSmell['highlight-range']['start-line'],
                  startColumn: locatedFn.codeSmell['highlight-range']['start-column'],
                  endLine: locatedFn.codeSmell['highlight-range']['end-line'],
                  endColumn: locatedFn.codeSmell['highlight-range']['end-column'],
                },
              }
            : undefined,
        }
      : undefined,
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
