import { devmode } from '../../../centralized-webview-framework/cwf-html-utils';
import { FileMetaType, DocsContextViewProps } from '../../../centralized-webview-framework/types';
import { getCWFDocType } from './utils';
import { CodeSceneTabPanelState } from './cwf-webview-docs-panel';
import { FunctionRange, IssueInfo } from '../../../documentation/commands';

export async function getDocsData(state: CodeSceneTabPanelState): Promise<DocsContextViewProps> {
  const { document, issueInfo, codeSmell } = state;
  const docTypeCwf = getCWFDocType(issueInfo.category);

  // Check if this issue is refactorable based on whether we have a codeSmell
  const isRefactorable = !!codeSmell;
  // Don't show button for general code health docs
  const visible = docTypeCwf !== 'docs_general_code_health';

  return {
    ideType: 'VSCode',
    view: 'docs',
    devmode: devmode,
    data: {
      docType: docTypeCwf,
      fileData: getFileData(state),
      autoRefactor: {
        visible,
        activated: true,
        disabled: !isRefactorable,
      },
    },
  };
}

function getFileData(state: CodeSceneTabPanelState): FileMetaType | undefined {
  const { issueInfo, document, functionRange } = state;
  const fileData =
    document && issueInfo
      ? {
          fileName: document?.fileName || '',
          fn: {
            name: issueInfo.fnName ?? functionRange?.function ?? '',
            range: getRange(functionRange),
          },
        }
      : undefined;
  return fileData;
}

function getRange(functionRange?: FunctionRange) {
  if (functionRange && functionRange.range) {
    // Use function range from review result
    return {
      startLine: functionRange.range['start-line'] ?? 0, // Adjusted only for display purposes (1-based)
      startColumn: 0,
      endLine: functionRange.range['end-line'] ?? 0,
      endColumn: 1,
    };
  } else {
    return undefined;
  }
}
