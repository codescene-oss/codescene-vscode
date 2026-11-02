/**
 * Samples of the messages the webview posts to the extension, as the message handlers expect them: one of each
 * message the home view, the docs panel and the auth view handle (ACE views and ACE messages excluded).
 * The contract-webview test runs them through the production handlers and validates them against the
 * message schema of the bundled webview.
 */
import type { FunctionInfoExternal } from '../../centralized-webview-framework/types/delta';
import type { MessageToIDEType } from '../../centralized-webview-framework/types/messages';
import type { AuthMessage } from '../../auth/auth-message-handler';

export interface HomeMessageContext {
  fileName: string;
  fn: FunctionInfoExternal;
  docType: string;
}

export function homeMessageSamples({ fileName, fn, docType }: HomeMessageContext): MessageToIDEType[] {
  return [
    { messageType: 'init', payload: 'home' },
    { messageType: 'goto-function-location', payload: { fileName, fn } },
    { messageType: 'goto-function-location', payload: { fileName } },
    { messageType: 'open-settings' },
    { messageType: 'open-docs-for-function', payload: { docType, fileName, fn } },
    { messageType: 'request-and-present-refactoring', payload: { fileName, fn } },
    { messageType: 'stop-analysis' },
    { messageType: 'start-analysis' },
  ];
}

export const docsMessageSamples: MessageToIDEType[] = [
  { messageType: 'init', payload: 'docs' },
  { messageType: 'open-settings' },
];

export const authMessageSamples: AuthMessage[] = [
  { messageType: 'open-auth' },
  { messageType: 'auth-sign-in' },
  { messageType: 'auth-open-browser-again' },
  { messageType: 'auth-cancel-sign-in' },
  { messageType: 'auth-sign-out' },
  { messageType: 'auth-retry' },
  { messageType: 'auth-select-account', payload: { accountId: '42' } },
  { messageType: 'auth-link-project', payload: { projectId: '101' } },
  { messageType: 'auth-link-project', payload: { projectId: null } },
  { messageType: 'auth-set-access-token', payload: { token: 'fake-token' } },
  { messageType: 'auth-remove-access-token' },
  { messageType: 'auth-open-server-setting' },
  { messageType: 'auth-open-pat-page' },
];

