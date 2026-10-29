import { fetchIdeToken } from '../auth/ide-token';
import { aceToken } from '../devtools-api';

export async function resolveAgentToken(): Promise<string | undefined> {
  return aceToken() ?? (await fetchIdeToken());
}
