import type { Account, AuthPayload, AuthStatus, Project } from '../centralized-webview-framework/types/auth';

export interface AuthRepo {
  path: string;
  name: string;
}

export interface AuthSnapshot {
  active: boolean;
  status: AuthStatus | null;
  accounts: Account[] | null;
  projects: Project[] | null;
  repo: AuthRepo | null;
  linkedProject: Project | null;
}

export const INACTIVE_SNAPSHOT: AuthSnapshot = {
  active: false,
  status: null,
  accounts: null,
  projects: null,
  repo: null,
  linkedProject: null,
};

export function toAuthPayload(snapshot: AuthSnapshot): AuthPayload | undefined {
  if (!snapshot.active || !snapshot.status) return undefined;
  return {
    status: snapshot.status,
    accounts: snapshot.accounts,
    projects: snapshot.projects,
    repo: snapshot.repo,
    'linked-project': snapshot.linkedProject,
  };
}

export function accountDataKey(status: AuthStatus | null): string | undefined {
  if (status?.state !== 'signed-in') return undefined;
  return [status.server.url, status['credential-source'], status.user?.id, status.account?.id].join('|');
}
