import { TextDocument } from 'vscode';
import { AceAcknowledgeContextViewProps, AutoRefactorConfig } from '../../../../centralized-webview-framework/types';
import { CsExtensionState } from '../../../../cs-extension-state';
import { RefactoringRequest } from '../../../../refactoring/request';
import { getFileData } from '../ace-data-mapper';
import { devmode } from '../../../../centralized-webview-framework/cwf-html-utils';

export function getAceAcknowledgeData(request: RefactoringRequest): AceAcknowledgeContextViewProps {
  return {
    view: 'aceAcknowledge',
    ideType: 'VSCode',
    devmode: devmode,
    data: {
      fileData: getFileData(request, request.document),
      autoRefactor: getAutoRefactorConfig(),
    },
  };
}

export function getAutoRefactorConfig(): AutoRefactorConfig {
  const data = {
    disabled: false,
    activated: CsExtensionState.acknowledgedAceUsage === true,
    visible: CsExtensionState.stateProperties.features.ace.state === 'enabled',
  };

  return data;
}
