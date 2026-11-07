import vscode from 'vscode';
import type { CredentialSource } from '../centralized-webview-framework/types/auth';
import type { AuthService } from './auth-service';

export const SIGN_IN_COMMAND = 'codescene.browserSignIn';
export const SIGN_OUT_COMMAND = 'codescene.browserSignOut';
export const SIGN_IN_CONTEXT_KEY = 'codescene.signInActive';
export const SIGN_IN_INACTIVE_MESSAGE = 'Sign-in needs a newer CodeScene CLI. Reload the window to update.';
export const TOKEN_SIGN_OUT_MESSAGE =
  'You are signed in with a personal access token. Remove it from the codescene.authToken setting to sign out.';
export const ENV_TOKEN_SIGN_OUT_MESSAGE =
  'You are signed in with the CS_ACCESS_TOKEN environment variable. Unset it and restart the editor to sign out.';
export const NOT_SIGNED_IN_MESSAGE = 'Not signed in to CodeScene.';

type CommandService = Pick<AuthService, 'current' | 'signIn' | 'signOut' | 'openAuth'>;

const TOKEN_SIGN_OUT_HINTS: Record<Exclude<CredentialSource, 'oauth'>, string> = {
  'setting-token': TOKEN_SIGN_OUT_MESSAGE,
  'env-token': ENV_TOKEN_SIGN_OUT_MESSAGE,
};

function signIn(service: CommandService): unknown {
  service.openAuth();
  return service.current.status?.state === 'signed-in' ? undefined : service.signIn();
}

function signOut(service: CommandService): unknown {
  const source = service.current.status?.['credential-source'] ?? null;
  if (source === 'oauth') return service.signOut();
  return vscode.window.showInformationMessage(source ? TOKEN_SIGN_OUT_HINTS[source] : NOT_SIGNED_IN_MESSAGE);
}

export function registerAuthCommands(service: CommandService): vscode.Disposable[] {
  const whenActive = (action: () => unknown) => () =>
    service.current.active ? action() : vscode.window.showInformationMessage(SIGN_IN_INACTIVE_MESSAGE);
  return [
    vscode.commands.registerCommand(SIGN_IN_COMMAND, whenActive(() => signIn(service))),
    vscode.commands.registerCommand(SIGN_OUT_COMMAND, whenActive(() => signOut(service))),
    vscode.commands.registerCommand('codescene.openAccount', whenActive(() => service.openAuth())),
  ];
}
