import { spawn } from 'child_process';
import * as path from 'path';
import { getExtensionPath } from '../cs-extension-state';
import { getEffectiveToken } from '../devtools-api';
import { buildAgentConfigWithToken } from './agent-config';
import { getAgentModel } from '../configuration';
import { logOutputChannel } from '../log';

export interface ConnectivityResult {
  success: boolean;
  error?: string;
}

function getAgentBinaryPath(): string {
  const extensionPath = getExtensionPath();
  if (!extensionPath) {
    throw new Error('Extension path not available');
  }
  const binaryName = process.platform === 'win32' ? 'cs-agent.exe' : 'cs-agent';
  return path.join(extensionPath, 'bin', binaryName);
}

export async function testConnectivity(): Promise<ConnectivityResult> {
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

  return new Promise((resolve) => {
    const proc = spawn(binaryPath, args, { env });
    let stderr = '';

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      logOutputChannel.error(`Connectivity test spawn error: ${err.message}`);
      resolve({ success: false, error: err.message });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        logOutputChannel.info('Connectivity test successful');
        resolve({ success: true });
      } else {
        const errorMsg = stderr.trim() || `Process exited with code ${code}`;
        logOutputChannel.error(`Connectivity test failed: ${errorMsg}`);
        resolve({ success: false, error: errorMsg });
      }
    });
  });
}
