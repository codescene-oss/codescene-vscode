import { spawn } from 'child_process';
import * as path from 'path';
import vscode from 'vscode';
import { getExtensionPath } from '../cs-extension-state';
import { getEffectiveToken } from '../devtools-api';
import { buildAgentConfigWithToken } from './agent-config';
import { getAgentModel } from '../configuration';
import { logOutputChannel } from '../log';

export interface ConnectivityResult {
  success: boolean;
  error?: string;
}

export interface ConnectivityOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function getAgentBinaryPath(): string {
  const extensionPath = getExtensionPath();
  if (!extensionPath) {
    throw new Error('Extension path not available');
  }
  const binaryName = process.platform === 'win32' ? 'cs-agent.exe' : 'cs-agent';
  return path.join(extensionPath, 'bin', binaryName);
}

const DEFAULT_TIMEOUT_MS = 60000;

export async function testConnectivity(options?: ConnectivityOptions): Promise<ConnectivityResult> {
  const token = getEffectiveToken();
  if (!token) {
    return { success: false, error: 'No authentication token available' };
  }

  const binaryPath = getAgentBinaryPath();
  const config = buildAgentConfigWithToken(token);
  const configJson = JSON.stringify(config);
  const model = getAgentModel();

  const args = ['run', 'skill:check-connectivity', '--model', model];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CS_AGENT_CONFIG: configJson,
  };

  logOutputChannel.debug(`Testing connectivity: ${binaryPath} ${args.join(' ')}`);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const proc = spawn(binaryPath, args, { cwd: workspaceFolder, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let resolved = false;

    const resolveOnce = (result: ConnectivityResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      options?.signal?.removeEventListener('abort', abortHandler);
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      logOutputChannel.warn('Connectivity test timed out');
      resolveOnce({ success: false, error: 'Connectivity test timed out' });
    }, timeoutMs);

    const abortHandler = () => {
      proc.kill('SIGTERM');
      logOutputChannel.info('Connectivity test cancelled');
      resolveOnce({ success: false, error: 'Connectivity test cancelled' });
    };

    options?.signal?.addEventListener('abort', abortHandler);

    proc.stdout?.on('data', (data: Buffer) => {
      logOutputChannel.debug(`Connectivity stdout: ${data.toString().trim()}`);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      logOutputChannel.error(`Connectivity test spawn error: ${err.message}`);
      resolveOnce({ success: false, error: err.message });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        logOutputChannel.info('Connectivity test successful');
        resolveOnce({ success: true });
      } else {
        const errorMsg = stderr.trim() || `Process exited with code ${code}`;
        logOutputChannel.error(`Connectivity test failed: ${errorMsg}`);
        resolveOnce({ success: false, error: errorMsg });
      }
    });
  });
}
