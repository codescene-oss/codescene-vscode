import { tokenFromResponse } from '../auth/auth-token';
import { aceToken, DevtoolsAPI } from '../devtools-api';
import { logOutputChannel } from '../log';
import { redactSecrets } from '../log-redaction';

async function fetchIdeToken(): Promise<string | undefined> {
  try {
    return tokenFromResponse(await DevtoolsAPI.authToken());
  } catch (error) {
    const detail = redactSecrets(error instanceof Error ? error.message : String(error));
    logOutputChannel.debug(`No IDE sign-in token available: ${detail}`);
    return undefined;
  }
}

export async function resolveAgentToken(): Promise<string | undefined> {
  return aceToken() ?? (await fetchIdeToken());
}
