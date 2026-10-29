import { execFile } from 'child_process';
import { ArtifactInfo } from '../artifact-info';
import { getConfiguration } from '../configuration';
import { getExtensionPath } from '../cs-extension-state';
import { logOutputChannel } from '../log';
import { redactSecrets } from '../log-redaction';

const TOKEN_TIMEOUT_MS = 20000;

interface CliTokenResponse {
  status?: string;
  'access-token'?: string;
}

export function parseIdeToken(stdout: string): string | undefined {
  try {
    const response = JSON.parse(stdout.trim()) as CliTokenResponse;
    const token = response['access-token']?.trim();
    return response.status === 'signed_in' && token ? token : undefined;
  } catch {
    return undefined;
  }
}

export function ideTokenEnv(serverUrl: string | undefined, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const url = serverUrl?.trim();
  return url ? { ...base, CS_ONPREM_URL: url } : base;
}

export function fetchIdeToken(): Promise<string | undefined> {
  const extensionPath = getExtensionPath();
  if (!extensionPath) return Promise.resolve(undefined);
  const executable = new ArtifactInfo(extensionPath).absoluteExecutablePath;
  const env = ideTokenEnv(getConfiguration<string>('serverUrl', ''));
  const args = ['auth', 'token', '--client', 'ide', '--output-format', 'json'];

  return new Promise((resolve) => {
    execFile(executable, args, { env, timeout: TOKEN_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      const token = parseIdeToken(stdout);
      if (!token) {
        const detail = redactSecrets((error?.message ?? stderr ?? '').trim());
        logOutputChannel.debug(`No IDE sign-in token available${detail ? `: ${detail}` : ''}`);
      }
      resolve(token);
    });
  });
}
