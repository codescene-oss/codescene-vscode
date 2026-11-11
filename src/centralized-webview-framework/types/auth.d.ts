export type AuthState = 'signed-out' | 'signing-in' | 'signed-in';

export type CredentialSource = 'oauth' | 'setting-token' | 'env-token';

export type AuthErrorCode =
  | 'auth/not-signed-in'
  | 'auth/oauth-unsupported'
  | 'auth/timeout'
  | 'auth/cancelled'
  | 'auth/port-unavailable'
  | 'auth/network'
  | 'auth/session-revoked'
  | 'auth/invalid-token';

export type AuthError = { code: AuthErrorCode; message: string };

export type AuthServer = {
  url: string;
  onprem: boolean;
  source: 'setting' | 'env' | 'default';
  'pat-url': string;
};

export type AuthStatus = {
  state: AuthState;
  'credential-source': CredentialSource | null;
  'env-token-present': boolean;
  server: AuthServer;
  'oauth-supported': boolean | null;
  user: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
  license: { pro: boolean } | null;
  'ace-credential': boolean;
  'expires-at': number | null;
  login: { 'login-id': string; 'authorize-url': string } | null;
  error: AuthError | null;
  'reauthorize-needed': boolean;
};

export type Account = {
  id: string;
  name: string;
  'signed-in-locally': boolean;
};

export type Project = { id: string; name: string };

export type AuthPayload = {
  status: AuthStatus;
  accounts: Account[] | null;
  projects: Project[] | null;
  repo: { path: string; name: string } | null;
  'linked-project': Project | null;
};

export type AuthStep = 'summary' | 'resolving' | 'pick-account' | 'pick-project';

export type ProjectSource = 'link' | 'remote';

export type ProjectReason =
  | 'no-remote'
  | 'repository-unknown'
  | 'other-account'
  | 'multiple-projects'
  | 'multiple-accounts'
  | 'lookup-failed';

export type ProjectCandidate = { id: string; name: string | null; 'account-id': string | null };

export type AuthFlow = {
  step: AuthStep;
  context: 'sign-in' | 'manual';
  'project-source': ProjectSource | null;
  syncing: boolean;
  'project-reason': ProjectReason | null;
  'project-candidates': ProjectCandidate[];
};
