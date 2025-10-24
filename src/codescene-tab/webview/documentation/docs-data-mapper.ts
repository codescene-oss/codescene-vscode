import { devmode } from '../../../centralized-webview-framework/cwf-html-utils';
import { FileMetaType, DocsContextViewProps } from '../../../centralized-webview-framework/types';
import { findFnToRefactor } from '../../../refactoring/utils';
import { getAutoRefactorConfig } from '../ace/acknowledgement/ace-acknowledgement-mapper';
import { getCWFDocType } from './utils';
import { CodeSceneTabPanelState } from './cwf-webview-docs-panel';
import { IssueInfo } from '../../../documentation/commands';

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
  const { issueInfo, document, fnToRefactor } = state;
  const fileData =
    document && issueInfo
      ? {
          fileName: document?.fileName || '',
          fn: {
            name: issueInfo.fnName ?? fnToRefactor?.name ?? '',
            range: getRange(issueInfo),
          },
        }
      : undefined;
  return fileData;
}

function getRange(issueInfo: IssueInfo) {
  if (!issueInfo.range) {
    return undefined;
  }

  return {
    startLine: (issueInfo.range.start.line ?? 0) + 1, // Adjusted only for display purposes (1-based)
    startColumn: 0,
    endLine: (issueInfo.range.end.line ?? 0) + 1,
    endColumn: 1,
  };
}
