import { FunctionInfoExternal } from './delta';
import { IdeContextType, WebViewPropsType } from './index';

export type MessageType = {
  messageType: 'update-renderer';
  payload: IdeContextType;
};

export type CommitBaselineType = 'default' | 'HEAD' | 'branchCreate';

export type OpenDocsMessage = {
  messageType: 'open-docs-for-function';
  payload: {
    docType: string;
    fileName: string;
    fn?: FunctionInfoExternal;
  };
};

export type MessageToIDEType =
  | { messageType: 'init'; payload: WebViewPropsType['view'] }
  | { messageType: 'commitBaseline'; payload: CommitBaselineType }
  | {
      messageType: 'goto-function-location';
      payload: { fileName: string; fn?: FunctionInfoExternal };
    }
  | { messageType: 'open-settings' }
  | OpenDocsMessage
  | {
      messageType: 'request-and-present-refactoring';
      payload: {
        fileName: string;
        fn?: FunctionInfoExternal;
      };
    }
  | {
      messageType: 'close-onboarding';
      payload: { userCompletedOnboarding: boolean };
    }
  | {
      messageType: 'init-login';
      payload: { type: 'cloud' | 'enterprise'; baseUrl: string };
    }
  | {
      messageType: 'select-codescene-project';
      payload: { id: number };
    }
  | {
      messageType: 'skip-select-codescene-project';
    }
  | {
      messageType: 'open-home';
    }
  | {
      messageType: 'open-login';
    }
  | {
      messageType: 'open-select-codescene-project';
    }
  | {
      messageType: 'show-onboarding';
    }
  | {
      messageType: 'apply';
    }
  | {
      messageType: 'close';
    }
  | {
      messageType: 'retry';
    }
  | {
      messageType: 'reject';
    }
  | {
      messageType: 'copyCode';
      payload?: { code: string };
    }
  | {
      messageType: 'acknowledged';
    }
  | {
      messageType: 'retry';
    }
  | {
      messageType: 'showDiff';
    }
  | {
      messageType: 'showLogoutput';
    }
  | {
      messageType: 'cancel';
    };
