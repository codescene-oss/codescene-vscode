import type { AuthStatus } from '../centralized-webview-framework/types/auth';
import { MissingAuthTokenError } from '../missing-auth-token-error';

export interface AceAuthState {
  active: boolean;
  status: Pick<AuthStatus, 'state'> | null;
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveAceToken(settingToken: string | undefined, legacyToken: string | undefined): string | undefined {
  return nonBlank(settingToken) ?? nonBlank(legacyToken);
}

export function isAceAvailable(token: string | undefined, auth: AceAuthState): boolean {
  return token !== undefined || (auth.active && auth.status?.state === 'signed-in');
}

export function refactorToken(token: string | undefined, auth: AceAuthState): string | undefined {
  if (!isAceAvailable(token, auth)) throw new MissingAuthTokenError();
  return token;
}
