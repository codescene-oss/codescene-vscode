import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getExtensionPath } from '../cs-extension-state';
import { AbortError } from '../devtools-api/abort-error';
import { logOutputChannel } from '../log';

const liveProcesses = new Set<ChildProcess>();

export class AgentTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The Refactoring Agent did not finish within ${Math.round(timeoutMs / 60000)} minutes.`);
    this.name = 'AgentTimeoutError';
  }
}

export interface WaitOptions {
  signal?: AbortSignal;
  timeoutMs: number;
}

export function agentBinaryPath(): string {
  const extensionPath = getExtensionPath();
  if (!extensionPath) {
    throw new Error('Extension path not available');
  }
  const binaryName = process.platform === 'win32' ? 'cs-agent.exe' : 'cs-agent';
  const binaryPath = path.join(extensionPath, 'bin', binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`The Refactoring Agent is not available for ${process.platform}-${process.arch}: ${binaryPath} is missing.`);
  }
  return binaryPath;
}

export function spawnAgent(args: string[], configJson: string, options: SpawnOptions): ChildProcess {
  const proc = spawn(agentBinaryPath(), args, {
    ...options,
    env: { ...process.env, CS_AGENT_CONFIG: configJson },
    detached: process.platform !== 'win32',
  });
  return trackAgentProcess(proc);
}

export function trackAgentProcess(proc: ChildProcess): ChildProcess {
  liveProcesses.add(proc);
  const forget = () => liveProcesses.delete(proc);
  proc.once('exit', forget);
  proc.once('error', forget);
  return proc;
}

export function waitForExit(proc: ChildProcess, { signal, timeoutMs }: WaitOptions): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      finish();
    };
    const stop = (error: Error) =>
      settle(() => {
        killProcessTree(proc);
        reject(error);
      });
    const onAbort = () => stop(new AbortError('Agent invocation aborted'));
    const timer = setTimeout(() => stop(new AgentTimeoutError(timeoutMs)), timeoutMs);

    proc.once('close', (code: number | null) => settle(() => resolve(code)));
    proc.once('error', (err: Error) => settle(() => reject(err)));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function killProcessTree(proc: ChildProcess): void {
  if (proc.pid === undefined || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-proc.pid, 'SIGTERM');
    }
  } catch (e) {
    logOutputChannel.warn(`Could not stop agent process ${proc.pid}: ${e}`);
    proc.kill('SIGTERM');
  }
}

export function killAllAgentProcesses(): void {
  for (const proc of liveProcesses) {
    killProcessTree(proc);
  }
  liveProcesses.clear();
}

export function liveAgentProcessCount(): number {
  return liveProcesses.size;
}
