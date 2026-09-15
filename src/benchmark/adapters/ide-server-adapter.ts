import { randomUUID } from 'crypto';
import { cpus } from 'os';
import vscode from 'vscode';
import { requiredDevtoolsVersion } from '../../artifact-info';
import { CsIdeServerClient, jarServerCommand } from '../../devtools-api/ide-server-client';
import { ReviewPipeline } from '../../review/review-pipeline';
import { ensureBinary } from '../../test/integration_helper';
import { BenchmarkAdapter, DEFAULT_QUIESCENCE, delay, QuiescenceOptions } from '../adapter';
import { FixtureFile } from '../fixture-repo';
import { ensureNativeBinary, nativeExecutablePath } from '../native-cli';
import { diskFileAccess, documentFor, silentPresentation } from './pipeline-plumbing';

const POLL_INTERVAL_MS = 100;

export { nativeExecutablePath };

export function productionServerArgs(): string[] {
  const threads = Math.max(1, Math.floor(cpus().length / 2));
  return ['server', '--threads', String(threads)];
}

export function benchmarkJvmArgs(): string[] {
  const xmx = process.env.CS_BENCH_JAVA_XMX ?? '512m';
  return ['-Xmx' + xmx, '-XX:G1PeriodicGCInterval=1000', '--enable-native-access=ALL-UNNAMED'];
}

export function jarBenchmarkCommand(distributionPath: string): { path: string; args: string[] } {
  return jarServerCommand(distributionPath, productionServerArgs(), benchmarkJvmArgs());
}

async function createJarClient(): Promise<CsIdeServerClient> {
  const command = jarBenchmarkCommand(await ensureBinary());
  return new CsIdeServerClient(command.path, command.args);
}

async function createNativeClient(): Promise<CsIdeServerClient> {
  const exePath = await ensureNativeBinary();
  return new CsIdeServerClient(exePath, productionServerArgs());
}

export function createBenchmarkAdapter(): IdeServerAdapter {
  if (process.env.CS_BENCH_CLI === 'native') {
    return new IdeServerAdapter('native-ide-server', createNativeClient);
  }
  return new IdeServerAdapter('ide-server', createJarClient);
}

export class IdeServerAdapter implements BenchmarkAdapter {
  startupMs = 0;
  sha = '';
  private client?: CsIdeServerClient;
  private pipeline?: ReviewPipeline;
  private readonly disposables: vscode.Disposable[] = [];
  private measurementStart = 0;
  private lastEventAt = 0;
  private eventCount = 0;
  private reviewLatencies: number[] = [];

  constructor(
    readonly name: string = 'ide-server',
    private readonly createClient: () => Promise<CsIdeServerClient> = createJarClient
  ) {}

  async start(): Promise<void> {
    const client = await this.createClient();
    this.disposables.push(
      client.onDidReview(() => this.markEvent(true)),
      client.onDidDelta(() => this.markEvent(false)),
      client.onDidReviewFailed(() => this.markEvent(false))
    );
    const startedAt = Date.now();
    const metadata = await client.start();
    this.startupMs = Date.now() - startedAt;
    const expectedSha = process.env.CS_IDE_REQUIRED_VERSION ?? requiredDevtoolsVersion;
    if (metadata.sha !== expectedSha) {
      client.dispose();
      throw new Error(`CLI SHA mismatch: expected ${expectedSha}, got ${metadata.sha}`);
    }
    this.sha = metadata.sha;
    this.client = client;
    this.pipeline = new ReviewPipeline(client, silentPresentation(), () => randomUUID(), diskFileAccess());
  }

  async restart(): Promise<void> {
    await this.requireClient().restart();
  }

  async stop(): Promise<void> {
    this.pipeline?.dispose();
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;
    this.client?.dispose();
    this.pipeline = undefined;
    this.client = undefined;
    await delay(POLL_INTERVAL_MS);
  }

  beginMeasurement(): void {
    this.measurementStart = Date.now();
    this.lastEventAt = this.measurementStart;
    this.reviewLatencies = [];
  }

  async enqueue(repoRoot: string, files: FixtureFile[]): Promise<void> {
    const pipeline = this.requirePipeline();
    const submissions = files.map((file) => ({
      document: documentFor(repoRoot, file.relPath, file.content),
      relPath: file.relPath,
      content: file.content,
      updateDiagnosticsPane: false,
      updateMonitor: true,
    }));
    await pipeline.submitBatch(repoRoot, submissions).catch(() => []);
  }

  watch(repoRoot: string): Promise<void> {
    this.requireClient().watchFiles(repoRoot);
    return Promise.resolve();
  }

  unwatch(repoRoot: string): Promise<void> {
    this.requireClient().stopWatchFiles(repoRoot);
    return Promise.resolve();
  }

  async waitForQuiescence(options: QuiescenceOptions = DEFAULT_QUIESCENCE): Promise<void> {
    const eventsAtStart = this.eventCount;
    const startedAt = Date.now();
    this.lastEventAt = startedAt;
    const deadline = startedAt + options.timeoutMs;
    while (Date.now() < deadline && !this.hasSettled(options, eventsAtStart, startedAt)) {
      await delay(POLL_INTERVAL_MS);
    }
  }

  latencies(): number[] {
    return this.reviewLatencies;
  }

  private hasSettled(options: QuiescenceOptions, eventsAtStart: number, startedAt: number): boolean {
    if (Date.now() - startedAt < options.minWaitMs) return false;
    if (options.expectEvents && this.eventCount === eventsAtStart) return false;
    return Date.now() - this.lastEventAt >= options.settleMs;
  }

  private markEvent(isReview: boolean): void {
    const now = Date.now();
    this.lastEventAt = now;
    this.eventCount++;
    if (isReview) this.reviewLatencies.push(now - this.measurementStart);
  }

  private requireClient(): CsIdeServerClient {
    if (!this.client) throw new Error('IdeServerAdapter has not been started');
    return this.client;
  }

  private requirePipeline(): ReviewPipeline {
    if (!this.pipeline) throw new Error('IdeServerAdapter has not been started');
    return this.pipeline;
  }
}
