import type {
  Account,
  AuthFlow,
  AuthPayload,
  AuthStatus,
  AuthStep,
  Project,
  ProjectSource,
} from '../centralized-webview-framework/types/auth';
import type { AuthSurface } from './auth-flow';

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
  projectSource: ProjectSource | null;
  surface: AuthSurface;
  step: AuthStep;
  context: AuthFlow['context'];
  syncing: boolean;
}

export const INACTIVE_SNAPSHOT: AuthSnapshot = {
  active: false,
  status: null,
  accounts: null,
  projects: null,
  repo: null,
  linkedProject: null,
  projectSource: null,
  surface: 'monitor',
  step: 'summary',
  context: 'manual',
  syncing: false,
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

export function toAuthFlow(snapshot: AuthSnapshot): AuthFlow | undefined {
  if (!snapshot.active) return undefined;
  return {
    step: snapshot.step,
    context: snapshot.context,
    'project-source': snapshot.projectSource,
    syncing: snapshot.syncing,
  };
}

export function accountDataKey(status: AuthStatus | null): string | undefined {
  if (status?.state !== 'signed-in') return undefined;
  return [status.server.url, status['credential-source'], status.user?.id, status.account?.id].join('|');
}
