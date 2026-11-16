import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as csExtensionState from '../cs-extension-state';

export type FakeAgentBehavior = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  outputFile?: string;
  output?: unknown;
  hang?: boolean;
};

export type FakeAgentInvocation = {
  args: string[];
  config: Record<string, any>;
  input?: unknown;
};

const preloadScript = `
const fs = require('fs');
const path = require('path');
const behavior = JSON.parse(process.env.FAKE_CS_AGENT_BEHAVIOR || '{}');
const config = JSON.parse(process.env.CS_AGENT_CONFIG || '{}');
const ioDir = config.io_json_dir;
const inputs = ioDir ? fs.readdirSync(ioDir).filter((f) => f.endsWith('.json')) : [];
const input = inputs.length > 0 ? JSON.parse(fs.readFileSync(path.join(ioDir, inputs[0]), 'utf8')) : undefined;
fs.writeFileSync(process.env.FAKE_CS_AGENT_RECORD, JSON.stringify({ args: process.argv.slice(2), config, input }));
if (behavior.hang) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
if (behavior.outputFile) fs.writeFileSync(path.join(ioDir, behavior.outputFile), JSON.stringify(behavior.output));
if (behavior.stdout) fs.writeSync(1, behavior.stdout);
if (behavior.stderr) fs.writeSync(2, behavior.stderr);
process.exit(behavior.exitCode ?? 0);
`;

function installBinary(binDir: string): void {
  const binary = path.join(binDir, process.platform === 'win32' ? 'cs-agent.exe' : 'cs-agent');
  try {
    fs.linkSync(process.execPath, binary);
  } catch {
    fs.copyFileSync(process.execPath, binary);
    fs.chmodSync(binary, 0o755);
  }
}

export class FakeAgent {
  readonly extensionPath: string;
  private readonly recordPath: string;
  private readonly preloadPath: string;
  private readonly originalGetExtensionPath = csExtensionState.getExtensionPath;
  private readonly originalEnv = {
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    FAKE_CS_AGENT_BEHAVIOR: process.env.FAKE_CS_AGENT_BEHAVIOR,
    FAKE_CS_AGENT_RECORD: process.env.FAKE_CS_AGENT_RECORD,
  };

  constructor() {
    this.extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fake-agent-'));
    const binDir = path.join(this.extensionPath, 'bin');
    fs.mkdirSync(binDir);
    installBinary(binDir);
    this.preloadPath = path.join(this.extensionPath, 'fake-agent-preload.js');
    fs.writeFileSync(this.preloadPath, preloadScript);
    this.recordPath = path.join(this.extensionPath, 'invocation.json');
  }

  activate(behavior: FakeAgentBehavior = {}): void {
    if (fs.existsSync(this.recordPath)) fs.rmSync(this.recordPath);
    process.env.NODE_OPTIONS = `--require "${this.preloadPath.replace(/\\/g, '/')}"`;
    process.env.FAKE_CS_AGENT_BEHAVIOR = JSON.stringify(behavior);
    process.env.FAKE_CS_AGENT_RECORD = this.recordPath;
    (csExtensionState as any).getExtensionPath = () => this.extensionPath;
  }

  deactivate(): void {
    for (const [key, value] of Object.entries(this.originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    (csExtensionState as any).getExtensionPath = this.originalGetExtensionPath;
  }

  invocation(): FakeAgentInvocation | undefined {
    return fs.existsSync(this.recordPath) ? JSON.parse(fs.readFileSync(this.recordPath, 'utf8')) : undefined;
  }

  async dispose(): Promise<void> {
    this.deactivate();
    await fs.promises.rm(this.extensionPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
