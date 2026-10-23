import type { MessageToIDEType } from '../centralized-webview-framework/types/messages';
import { logOutputChannel } from '../log';
import { authErrorCode } from './auth-rpc';
import type { AuthService } from './auth-service';

export const AUTH_MESSAGE_TYPES = [
  'open-auth',
  'auth-sign-in',
  'auth-open-browser-again',
  'auth-cancel-sign-in',
  'auth-sign-out',
  'auth-retry',
  'auth-select-account',
  'auth-link-project',
  'auth-set-access-token',
  'auth-remove-access-token',
  'auth-open-server-setting',
  'auth-open-pat-page',
] as const;

type AuthMessageType = (typeof AUTH_MESSAGE_TYPES)[number];
export type AuthMessage = Extract<MessageToIDEType, { messageType: AuthMessageType }>;
type MessageOf<K extends AuthMessageType> = Extract<AuthMessage, { messageType: K }>;
type Handlers = { [K in AuthMessageType]: (message: MessageOf<K>) => unknown };

export type AuthActions = Pick<
  AuthService,
  | 'current'
  | 'signIn'
  | 'openBrowserAgain'
  | 'cancelSignIn'
  | 'signOut'
  | 'retry'
  | 'selectAccount'
  | 'linkProject'
  | 'setAccessToken'
  | 'removeAccessToken'
>;

export interface AuthMessageTarget {
  showAuthView(): void;
  openServerSetting(): Thenable<unknown>;
  openExternal(url: string): Thenable<unknown>;
}

export function isAuthMessage(message: MessageToIDEType): message is AuthMessage {
  return (AUTH_MESSAGE_TYPES as readonly string[]).includes(message.messageType);
}

function openPatPage(actions: AuthActions, target: AuthMessageTarget): Thenable<unknown> | undefined {
  const url = actions.current.status?.server['pat-url'];
  return url ? target.openExternal(url) : undefined;
}

function handlers(actions: AuthActions, target: AuthMessageTarget): Handlers {
  return {
    'open-auth': () => target.showAuthView(),
    'auth-sign-in': () => actions.signIn(),
    'auth-open-browser-again': () => actions.openBrowserAgain(),
    'auth-cancel-sign-in': () => actions.cancelSignIn(),
    'auth-sign-out': () => actions.signOut(),
    'auth-retry': () => actions.retry(),
    'auth-select-account': (message) => actions.selectAccount(message.payload.accountId),
    'auth-link-project': (message) => actions.linkProject(message.payload.projectId),
    'auth-set-access-token': (message) => actions.setAccessToken(message.payload.token),
    'auth-remove-access-token': () => actions.removeAccessToken(),
    'auth-open-server-setting': () => target.openServerSetting(),
    'auth-open-pat-page': () => openPatPage(actions, target),
  };
}

export async function handleAuthMessage(actions: AuthActions, target: AuthMessageTarget, message: AuthMessage): Promise<void> {
  const handler = handlers(actions, target)[message.messageType] as (message: AuthMessage) => unknown;
  await handler(message);
}

let registered: { actions: AuthActions; target: AuthMessageTarget } | undefined;

export function registerAuthMessages(actions: AuthActions, target: AuthMessageTarget): { dispose(): void } {
  registered = { actions, target };
  return {
    dispose: () => {
      registered = undefined;
    },
  };
}

export async function routeAuthMessage(message: MessageToIDEType): Promise<boolean> {
  if (!registered || !isAuthMessage(message)) return false;
  try {
    await handleAuthMessage(registered.actions, registered.target, message);
  } catch (error) {
    logOutputChannel.warn(`[auth] ${message.messageType} failed code=${authErrorCode(error) ?? 'unknown'}`);
  }
  return true;
}
