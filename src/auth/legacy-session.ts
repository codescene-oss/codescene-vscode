import type { SecretStorage } from 'vscode';

export const LEGACY_SESSIONS_KEY = 'codescene.sessions';

export interface LegacySession {
  accessToken: string;
  userId: string | undefined;
}

function firstSession(value: unknown): LegacySession | undefined {
  const first = Array.isArray(value) ? (value[0] as Record<string, any> | undefined) : undefined;
  const accessToken = first?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken.trim()) return undefined;
  const userId = first?.account?.id;
  return { accessToken, userId: typeof userId === 'string' ? userId : undefined };
}

export async function readLegacySession(secrets: Pick<SecretStorage, 'get'>): Promise<LegacySession | undefined> {
  try {
    const stored = await secrets.get(LEGACY_SESSIONS_KEY);
    return stored ? firstSession(JSON.parse(stored)) : undefined;
  } catch {
    return undefined;
  }
}
