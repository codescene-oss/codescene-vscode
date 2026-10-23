import type { Project } from '../centralized-webview-framework/types/auth';
import { logOutputChannel } from '../log';
import type { AuthRepo, AuthSnapshot } from './auth-payload';
import { authErrorCode, type AuthRpc } from './auth-rpc';

export type AccountData = Pick<AuthSnapshot, 'accounts' | 'projects' | 'linkedProject'>;

export const EMPTY_ACCOUNT_DATA: AccountData = { accounts: null, projects: null, linkedProject: null };

async function optional<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    logOutputChannel.warn(`[auth] account data request failed code=${authErrorCode(error) ?? 'unknown'}`);
    return null;
  }
}

export async function fetchLinkedProject(rpc: AuthRpc, repo: AuthRepo | null): Promise<Project | null> {
  if (!repo) return null;
  const link = await optional(rpc.getProjectLink(repo.path));
  return link?.project ?? null;
}

export async function fetchAccountData(rpc: AuthRpc, repo: AuthRepo | null): Promise<AccountData> {
  const [accounts, projects, linkedProject] = await Promise.all([
    optional(rpc.listAccounts()),
    optional(rpc.listProjects()),
    fetchLinkedProject(rpc, repo),
  ]);
  return { accounts, projects, linkedProject };
}
