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
  const { document, issueInfo, codeSmell, fnToRefactor, fileData } = state;
  const docTypeCwf = getCWFDocType(issueInfo.category);

  const config = getAutoRefactorConfig();
  const toRefactor = fnToRefactor ?? (await findFnToRefactor(document, codeSmell));

  return {
    ideType: 'VSCode',
    view: 'docs',
    devmode: devmode,
    data: {
      docType: docTypeCwf,
      fileData,
      autoRefactor: { ...config, disabled: config.disabled || !toRefactor },
    },
  };
}

export function getFileData(params: InteractiveDocsParams): FileMetaType | undefined {
  const { issueInfo, document } = params;
  const fileData =
    document && issueInfo
      ? {
          fileName: document?.fileName || '',
          fn: issueInfo.fnName
            ? {
                name: issueInfo.fnName,
                range: issueInfo.position
                  ? {
                      startLine: issueInfo.position.line,
                      startColumn: 0,
                      endLine: issueInfo.position.line,
                      endColumn: 1,
                    }
                  : undefined,
              }
            : undefined,
        }
      : undefined;
  return fileData;
}
