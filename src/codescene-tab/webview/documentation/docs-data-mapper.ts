import vscode from 'vscode';
import { devmode } from '../../../centralized-webview-framework/cwf-html-utils';
import { FileMetaType, DocsContextViewProps } from '../../../centralized-webview-framework/types';
import { CodeSmell } from '../../../devtools-api/review-model';
import { InteractiveDocsParams } from '../../../documentation/commands';
import { findFnToRefactor } from '../../../refactoring/utils';
import { getAutoRefactorConfig } from '../ace/acknowledgement/ace-acknowledgement-mapper';
import { getCWFDocType } from './utils';
import { CodeSceneTabPanelState } from './cwf-webview-docs-panel';

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

export function getFileData(state: CodeSceneTabPanelState): FileMetaType | undefined {
  const { issueInfo, document, fnToRefactor } = state;
  const fileData =
    document && issueInfo
      ? {
          fileName: document?.fileName || '',
          fn: {
            name: issueInfo.fnName ?? fnToRefactor?.name ?? '',
            range: issueInfo.position
              ? {
                  startLine: issueInfo.position.line + 1, // Adjusted only for display purposes (1-based vs 0-based). For navigation (goto-function-location), the original value is used.
                  startColumn: 0,
                  endLine: issueInfo.position.line + 1,
                  endColumn: 1,
                }
              : undefined,
          },
        }
      : undefined;
  return fileData;
}
