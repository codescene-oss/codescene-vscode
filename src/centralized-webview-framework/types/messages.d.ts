import { FunctionInfoExternal } from './delta';
import { IdeContextType, WebViewPropsType } from './index';

export type MessageType = {
  messageType: 'update-renderer';
  payload: IdeContextType;
};

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
    }
  | {
      messageType: 'stop-analysis';
    }
  | {
      messageType: 'start-analysis';
    }
  | { messageType: 'open-auth' }
  | { messageType: 'auth-sign-in' }
  | { messageType: 'auth-open-browser-again' }
  | { messageType: 'auth-cancel-sign-in' }
  | { messageType: 'auth-sign-out' }
  | { messageType: 'auth-retry' }
  | { messageType: 'auth-select-account'; payload: { accountId: string } }
  | { messageType: 'auth-link-project'; payload: { projectId: string | null } }
  | { messageType: 'auth-set-access-token'; payload: { token: string } }
  | { messageType: 'auth-remove-access-token' }
  | { messageType: 'auth-open-server-setting' }
  | { messageType: 'auth-open-pat-page' };
