import type { Account, AuthErrorCode, AuthStatus, Project } from '../centralized-webview-framework/types/auth';
import type { AuthTransport } from './auth-transport';

const AUTH_ERROR = -32803;
const METHOD_NOT_FOUND = -32601;

export interface AuthConfiguration {
  'server-url': string | null;
  'access-token': string | null;
}

export interface LoginStart {
  'login-id': string;
  'authorize-url': string;
}

export interface ProjectLink {
  project: Project | null;
}

export class AuthRpc {
  constructor(private readonly transport: AuthTransport) {}

  configure(configuration: AuthConfiguration): Promise<AuthStatus> {
    return this.transport.request('cs-ide/auth-configure', configuration);
  }

  status(): Promise<AuthStatus> {
    return this.transport.request('cs-ide/auth-status', {});
  }

  login(): Promise<LoginStart> {
    return this.transport.request('cs-ide/auth-login', {});
  }

  cancelLogin(loginId: string): Promise<AuthStatus> {
    return this.transport.request('cs-ide/auth-cancel-login', { 'login-id': loginId });
  }

  logout(): Promise<AuthStatus> {
    return this.transport.request('cs-ide/auth-logout', {});
  }

  listAccounts(): Promise<Account[]> {
    return this.transport.request('cs-ide/auth-list-accounts', {});
  }

  selectAccount(accountId: string): Promise<AuthStatus> {
    return this.transport.request('cs-ide/auth-select-account', { 'account-id': accountId });
  }

  syncAccount(repoPath: string): Promise<AuthStatus> {
    return this.transport.request('cs-ide/auth-sync-account', { 'repo-path': repoPath });
  }

  listProjects(): Promise<Project[]> {
    return this.transport.request('cs-ide/projects-list', {});
  }

  getProjectLink(repoPath: string): Promise<ProjectLink> {
    return this.transport.request('cs-ide/project-link-get', { 'repo-path': repoPath });
  }

  setProjectLink(repoPath: string, projectId: string | null): Promise<ProjectLink> {
    return this.transport.request('cs-ide/project-link-set', { 'repo-path': repoPath, 'project-id': projectId });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAuthRpcError(error: unknown): error is { code: number; data: Record<string, unknown> } {
  if (!isRecord(error)) return false;
  if (error.code !== AUTH_ERROR) return false;
  return isRecord(error.data);
}

export function isMethodNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === METHOD_NOT_FOUND;
}

export function authErrorCode(error: unknown): AuthErrorCode | undefined {
  if (!isAuthRpcError(error)) return undefined;
  const code = error.data.code;
  return typeof code === 'string' ? (code as AuthErrorCode) : undefined;
}
