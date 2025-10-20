import { devmode } from '../../../centralized-webview-framework/cwf-html-utils';
import { FileMetaType, DocsContextViewProps } from '../../../centralized-webview-framework/types';
import { InteractiveDocsParams } from '../../../documentation/commands';
import { getCWFDocType } from './utils';

export function getDocsData(docType: string, fileData: FileMetaType | undefined): DocsContextViewProps {
  const docTypeCwf = getCWFDocType(docType);
  return {
    ideType: 'VSCode',
    view: 'docs',
    devmode: devmode,
    data: {
      docType: docTypeCwf,
      fileData,
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
