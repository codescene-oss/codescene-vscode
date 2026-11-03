import { logOutputChannel } from '../log';
import type { AuthRepo, AuthSnapshot } from './auth-payload';
import { authErrorCode, type AuthRpc, type ProjectLink } from './auth-rpc';

type LinkFields = Pick<AuthSnapshot, 'linkedProject' | 'projectSource' | 'projectReason' | 'projectCandidates'>;

export type AccountData = Pick<AuthSnapshot, 'accounts' | 'projects'> & LinkFields;

export const NO_LINK: LinkFields = { linkedProject: null, projectSource: null, projectReason: null, projectCandidates: [] };

export const EMPTY_ACCOUNT_DATA: AccountData = { accounts: null, projects: null, ...NO_LINK };

async function optional<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    logOutputChannel.warn(`[auth] account data request failed code=${authErrorCode(error) ?? 'unknown'}`);
    return null;
  }
}

export async function fetchProjectLink(rpc: AuthRpc, repo: AuthRepo | null): Promise<ProjectLink | null> {
  if (!repo) return null;
  return optional(rpc.getProjectLink(repo.path));
}

export function linkFields(link: ProjectLink | null): LinkFields {
  const linkedProject = link?.project ?? null;
  if (linkedProject) return { ...NO_LINK, linkedProject, projectSource: link?.source ?? null };
  return { ...NO_LINK, projectReason: link?.reason ?? null, projectCandidates: link?.candidates ?? [] };
}

export async function fetchAccountData(rpc: AuthRpc, repo: AuthRepo | null): Promise<AccountData> {
  const [accounts, projects, link] = await Promise.all([
    optional(rpc.listAccounts()),
    optional(rpc.listProjects()),
    fetchProjectLink(rpc, repo),
  ]);
  return { accounts, projects, ...linkFields(link) };
}
