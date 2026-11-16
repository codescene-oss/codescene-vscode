import { ChildProcess } from 'child_process';
import vscode from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { aceUsable } from '../devtools-api';
import { AbortError } from '../devtools-api/abort-error';
import { buildAgentConfigWithToken, RENDER_CODE_FIX_SKILL } from './agent-config';
import { getAgentModel } from '../configuration';
import { logOutputChannel } from '../log';
import { AgentTimeoutError, spawnAgent, waitForExit } from './agent-process';
import { resolveAgentToken } from './agent-token';
import { getAgentProviderOptions } from './provider-secrets';

export interface ConnectivityResult {
  success: boolean;
  error?: string;
}

export interface ConnectivityOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60000;

function failureMessage(error: unknown): string {
  if (error instanceof AbortError) return 'Connectivity test cancelled';
  if (error instanceof AgentTimeoutError) return 'Connectivity test timed out';
  return error instanceof Error ? error.message : String(error);
}

async function connectivityArgs(): Promise<{ args: string[]; configJson: string }> {
  const providerOptions = await getAgentProviderOptions();
  const server = CsExtensionState.stateProperties.auth.status?.server;
  const config = buildAgentConfigWithToken(await resolveAgentToken(), RENDER_CODE_FIX_SKILL.plugin, undefined, server, providerOptions);
  return { args: ['run', 'skill:check-connectivity', '--model', getAgentModel(providerOptions)], configJson: JSON.stringify(config) };
}

function collectStderr(proc: ChildProcess): () => string {
  let stderr = '';
  proc.stdout?.on('data', (data: Buffer) => logOutputChannel.debug(`Connectivity stdout: ${data.toString().trim()}`));
  proc.stderr?.on('data', (data: Buffer) => (stderr += data.toString()));
  return () => stderr.trim();
}

async function runConnectivityCheck(options?: ConnectivityOptions): Promise<void> {
  const { args, configJson } = await connectivityArgs();
  logOutputChannel.debug(`Testing connectivity: cs-agent ${args.join(' ')}`);

  const proc = spawnAgent(args, configJson, {
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = collectStderr(proc);

  const code = await waitForExit(proc, { signal: options?.signal, timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  if (code !== 0) {
    throw new Error(stderr() || `Process exited with code ${code}`);
  }
}

export async function testConnectivity(options?: ConnectivityOptions): Promise<ConnectivityResult> {
  try {
    await runConnectivityCheck(options);
    logOutputChannel.info('Connectivity test successful');
    return { success: true };
  } catch (error) {
    const message = failureMessage(error);
    logOutputChannel.error(`Connectivity test failed: ${message}`);
    return { success: false, error: message };
  }
}

function reportConnectivity(result: ConnectivityResult): void {
  if (result.success) {
    void vscode.window.showInformationMessage('Provider connectivity test successful.');
  } else if (!result.error?.includes('cancelled')) {
    void vscode.window.showErrorMessage(`Provider connectivity test failed: ${result.error}`);
  }
}

export async function runConnectivityTestCommand(): Promise<void> {
  if (!aceUsable()) {
    void vscode.window.showInformationMessage(
      'Enable "Enable Auto Refactor" and sign in to CodeScene to test provider connectivity.'
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Testing provider connectivity...',
      cancellable: true,
    },
    async (progress, cancelToken) => {
      void progress;
      const abortController = new AbortController();
      cancelToken.onCancellationRequested(() => abortController.abort());
      reportConnectivity(await testConnectivity({ signal: abortController.signal }));
    }
  );
}
