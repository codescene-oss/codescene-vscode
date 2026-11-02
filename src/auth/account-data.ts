import { logOutputChannel } from '../log';
import type { AuthRepo, AuthSnapshot } from './auth-payload';
import { authErrorCode, type AuthRpc, type ProjectLink } from './auth-rpc';

export type AccountData = Pick<AuthSnapshot, 'accounts' | 'projects' | 'linkedProject' | 'projectSource'>;

export const EMPTY_ACCOUNT_DATA: AccountData = { accounts: null, projects: null, linkedProject: null, projectSource: null };

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

export function linkFields(link: ProjectLink | null): Pick<AuthSnapshot, 'linkedProject' | 'projectSource'> {
  const linkedProject = link?.project ?? null;
  return { linkedProject, projectSource: linkedProject ? (link?.source ?? null) : null };
}

export async function fetchAccountData(rpc: AuthRpc, repo: AuthRepo | null): Promise<AccountData> {
  const [accounts, projects, link] = await Promise.all([
    optional(rpc.listAccounts()),
    optional(rpc.listProjects()),
    fetchProjectLink(rpc, repo),
  ]);
  return { accounts, projects, ...linkFields(link) };
}
