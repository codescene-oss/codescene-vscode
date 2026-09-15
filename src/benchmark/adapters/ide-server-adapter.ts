import { randomUUID } from 'crypto';
import vscode from 'vscode';
import { CsIdeServerClient } from '../../devtools-api/ide-server-client';
import { ReviewPipeline } from '../../review/review-pipeline';
import { ensureBinary } from '../../test/integration_helper';
import { BenchmarkAdapter, DEFAULT_QUIESCENCE, delay, QuiescenceOptions } from '../adapter';
import { FixtureFile } from '../fixture-repo';
import { diskFileAccess, documentFor, silentPresentation } from './pipeline-plumbing';

const POLL_INTERVAL_MS = 100;

export class IdeServerAdapter implements BenchmarkAdapter {
  readonly name = 'ide-server';
  private client?: CsIdeServerClient;
  private pipeline?: ReviewPipeline;
  private readonly disposables: vscode.Disposable[] = [];
  private measurementStart = 0;
  private lastEventAt = 0;
  private eventCount = 0;
  private reviewLatencies: number[] = [];

  async start(): Promise<void> {
    const binaryPath = await ensureBinary();
    const client = CsIdeServerClient.fromDistribution(binaryPath);
    this.disposables.push(
      client.onDidReview(() => this.markEvent(true)),
      client.onDidDelta(() => this.markEvent(false)),
      client.onDidReviewFailed(() => this.markEvent(false))
    );
    await client.start();
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
