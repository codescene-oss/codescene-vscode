import { devmode } from '../../../centralized-webview-framework/cwf-html-utils';
import { FileMetaType, DocsContextViewProps } from '../../../centralized-webview-framework/types';
import { findFnToRefactor } from '../../../refactoring/utils';
import { getAutoRefactorConfig } from '../ace/acknowledgement/ace-acknowledgement-mapper';
import { getCWFDocType } from './utils';
import { CodeSceneTabPanelState } from './cwf-webview-docs-panel';
import { FunctionRange, IssueInfo } from '../../../documentation/commands';
import { FnToRefactor } from '../../../devtools-api/refactor-models';

export async function getDocsData(state: CodeSceneTabPanelState): Promise<DocsContextViewProps> {
  const { document, issueInfo, codeSmell, fnToRefactor } = state;
  const docTypeCwf = getCWFDocType(issueInfo.category);

  const config = getAutoRefactorConfig();
  const toRefactor = fnToRefactor ?? (await findFnToRefactor(document, codeSmell));
  if (toRefactor) state.fnToRefactor = toRefactor;

  return {
    ideType: 'VSCode',
    view: 'docs',
    devmode: devmode,
    data: {
      docType: docTypeCwf,
      fileData: getFileData(state),
      autoRefactor: {
        ...config,
        visible: config.visible && docTypeCwf !== 'docs_general_code_health',
        disabled: config.disabled || !toRefactor,
      },
    },
  };
}

function getFileData(state: CodeSceneTabPanelState): FileMetaType | undefined {
  const { issueInfo, document, fnToRefactor, functionRange } = state;
  const fileData =
    document && issueInfo
      ? {
          fileName: document?.fileName || '',
          fn: {
            name: issueInfo.fnName ?? fnToRefactor?.name ?? functionRange?.function ?? '',
            range: getRange(issueInfo, fnToRefactor, functionRange),
          },
        }
      : undefined;
  return fileData;
}

function getRange(issueInfo: IssueInfo, fnToRefactor: FnToRefactor | undefined, functionRange?: FunctionRange) {
  if (fnToRefactor && fnToRefactor.range) {
    return {
      startLine: fnToRefactor.range['start-line'] ?? 0, // Adjusted only for display purposes (1-based)
      startColumn: 0,
      endLine: fnToRefactor.range['end-line'] ?? 0,
      endColumn: 1,
    };
  } else if (functionRange && functionRange.range) {
    // Use function range from review result when fnToRefactor is not available
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
