import vscode from 'vscode';
import type { CredentialSource } from '../centralized-webview-framework/types/auth';
import type { AuthService } from './auth-service';

export const SIGN_IN_CONTEXT_KEY = 'codescene.signInActive';
export const SIGN_IN_INACTIVE_MESSAGE =
  'Browser sign-in is experimental. Turn on the codescene.experimental.signIn setting to use it.';
export const TOKEN_SIGN_OUT_MESSAGE =
  'You are signed in with a personal access token. Remove it from the codescene.authToken setting to sign out.';
export const ENV_TOKEN_SIGN_OUT_MESSAGE =
  'You are signed in with the CS_ACCESS_TOKEN environment variable. Unset it and restart the editor to sign out.';
export const NOT_SIGNED_IN_MESSAGE = 'Not signed in to CodeScene.';

type CommandService = Pick<AuthService, 'current' | 'signIn' | 'signOut'>;

const TOKEN_SIGN_OUT_HINTS: Record<Exclude<CredentialSource, 'oauth'>, string> = {
  'setting-token': TOKEN_SIGN_OUT_MESSAGE,
  'env-token': ENV_TOKEN_SIGN_OUT_MESSAGE,
};

function signIn(service: CommandService, showAuthView: () => void): unknown {
  showAuthView();
  return service.current.status?.state === 'signed-in' ? undefined : service.signIn();
}

function signOut(service: CommandService): unknown {
  const source = service.current.status?.['credential-source'] ?? null;
  if (source === 'oauth') return service.signOut();
  return vscode.window.showInformationMessage(source ? TOKEN_SIGN_OUT_HINTS[source] : NOT_SIGNED_IN_MESSAGE);
}

export function registerAuthCommands(service: CommandService, showAuthView: () => void): vscode.Disposable[] {
  const whenActive = (action: () => unknown) => () =>
    service.current.active ? action() : vscode.window.showInformationMessage(SIGN_IN_INACTIVE_MESSAGE);
  return [
    vscode.commands.registerCommand('codescene.signIn', whenActive(() => signIn(service, showAuthView))),
    vscode.commands.registerCommand('codescene.signOut', whenActive(() => signOut(service))),
    vscode.commands.registerCommand('codescene.openAccount', whenActive(showAuthView)),
  ];
}
