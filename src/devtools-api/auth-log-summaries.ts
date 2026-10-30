import type { AuthStatus } from '../centralized-webview-framework/types/auth';
import { formatLogFields } from '../log';

type Summary = (value: Record<string, unknown>) => string;

export function authStatusSummary(status: Pick<AuthStatus, 'state' | 'credential-source' | 'error'>): string {
  return formatLogFields({
    state: status.state,
    source: status['credential-source'],
    errorCode: status.error?.code ?? null,
  });
}

const statusResponse: Summary = (value) => authStatusSummary(value as unknown as AuthStatus);

export const authRequestSummaries: Record<string, Summary> = {
  'cs-ide/auth-configure': (value) => formatLogFields({
    serverUrl: value['server-url'],
    hasAccessToken: typeof value['access-token'] === 'string',
  }),
  'cs-ide/auth-select-account': (value) => formatLogFields({ accountId: value['account-id'] }),
  'cs-ide/project-link-get': (value) => formatLogFields({ repoPath: value['repo-path'] }),
  'cs-ide/project-link-set': (value) => formatLogFields({ repoPath: value['repo-path'], projectId: value['project-id'] }),
};

export const authResponseSummaries: Record<string, Summary> = {
  'cs-ide/auth-configure': statusResponse,
  'cs-ide/auth-status': statusResponse,
  'cs-ide/auth-cancel-login': statusResponse,
  'cs-ide/auth-logout': statusResponse,
  'cs-ide/auth-select-account': statusResponse,
  'cs-ide/auth-token': (value) => formatLogFields({ source: value['credential-source'] }),
};
