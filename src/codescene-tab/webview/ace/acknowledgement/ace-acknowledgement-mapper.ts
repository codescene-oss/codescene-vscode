import { ACE_ENABLED } from '../../../../build-flags';
import { AceAcknowledgeContextViewProps, AutoRefactorConfig } from '../../../../centralized-webview-framework/types';
import { CsExtensionState } from '../../../../cs-extension-state';
import { RefactoringRequest } from '../../../../refactoring/request';
import { getFileData } from '../ace-data-mapper';
import { devmode } from '../../../../centralized-webview-framework/cwf-html-utils';
import { aceAvailable } from '../../../../devtools-api';

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
  if (!ACE_ENABLED) {
    return { disabled: true, activated: false, visible: false };
  }

  const authenticated = aceAvailable();
  const acknowledged = CsExtensionState.acknowledgedAceUsage === true;
  const activated = !(!acknowledged && authenticated);

  return {
    disabled: !authenticated,
    activated,
    visible: authenticated && CsExtensionState.stateProperties.features.ace.state === 'enabled',
  };
}
