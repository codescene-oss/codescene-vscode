import { FileMetaType, DocsContextViewProps } from '../../../centralized-webview-framework/types';
import { InteractiveDocsParams } from '../../../documentation/commands';
import { getCWFDocType } from './utils';

export function getDocsData(docType: string, fileData: FileMetaType): DocsContextViewProps {
  const docTypeCwf = getCWFDocType(docType);
  return {
    ideType: 'VSCode',
    view: 'docs',
    devmode: true,
    data: {
      docType: docTypeCwf,
      fileData,
    },
  };
}

export function getFileData(params: InteractiveDocsParams): FileMetaType {
  const { issueInfo, document } = params;
  const fileData: FileMetaType = {
    fileName: document.fileName,
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
  };
  return fileData;
}
