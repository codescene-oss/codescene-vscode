export interface AuthTokenResponse {
  'credential-source': 'env-token' | 'setting-token' | 'oauth';
  'access-token': string;
}

export function tokenFromResponse(response: Partial<AuthTokenResponse> | null | undefined): string | undefined {
  const token = response?.['access-token']?.trim();
  return token ? token : undefined;
}
