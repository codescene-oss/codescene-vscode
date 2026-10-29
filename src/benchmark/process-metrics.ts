import * as path from 'path';
import pidusage from 'pidusage';
import { ProcessTracker } from './process-tracker';

const SAMPLE_INTERVAL_MS = 50;
const BYTES_PER_MB = 1024 * 1024;
const SAMPLER_COMMANDS = /^(wmic|powershell|pwsh|ps|tasklist|taskkill)(\.exe)?$/i;

/**
 * cliCpuMs is best effort. Processes that live for less than a sampling round trip are never
 * observed, which matters for the one process per review architecture. childWallMs is exact,
 * because it comes from the spawn and exit events rather than from sampling.
 */
export interface ResourceSample {
  wallMs: number;
  cliCpuMs: number;
  harnessCpuMs: number;
  peakRssMb: number;
  processCount: number;
  childWallMs: number;
}

function isSamplerCommand(command: string): boolean {
  return SAMPLER_COMMANDS.test(path.basename(command));
}

function total(values: Iterable<number>): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}

export class ProcessMetrics {
  private readonly tracker = new ProcessTracker(isSamplerCommand);
  private readonly cpuByPid = new Map<number, number>();
  private readonly cpuBaseline = new Map<number, number>();
  private timer?: ReturnType<typeof setInterval>;
  private sampling = false;
  private startedAt = 0;
  private peakRssBytes = 0;

  install(): void {
    this.tracker.install();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.tracker.uninstall();
    pidusage.clear();
  }

  async start(): Promise<void> {
    this.cpuByPid.clear();
    this.cpuBaseline.clear();
    this.peakRssBytes = 0;
    this.tracker.startWindow();
    this.startedAt = Date.now();
    await this.sample();
    this.timer = setInterval(() => void this.sample(), SAMPLE_INTERVAL_MS);
  }

  async stop(): Promise<ResourceSample> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.sample();
    const now = Date.now();
    return {
      wallMs: now - this.startedAt,
      cliCpuMs: total(this.childCpu()),
      harnessCpuMs: this.cpuByPid.get(process.pid) ?? 0,
      peakRssMb: this.peakRssBytes / BYTES_PER_MB,
      processCount: this.tracker.records().length,
      childWallMs: this.tracker.windowWallMs(now),
    };
  }

  private childCpu(): number[] {
    return Array.from(this.cpuByPid.entries())
      .filter(([pid]) => pid !== process.pid)
      .map(([, cpuMs]) => cpuMs);
  }

  private async sample(): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const stats = await pidusage([process.pid, ...this.tracker.livePids()]);
      this.peakRssBytes = Math.max(this.peakRssBytes, this.accumulate(stats));
    } catch {
      return;
    } finally {
      this.sampling = false;
    }
  }

  private accumulate(stats: { [key: string]: pidusage.Status }): number {
    let rssBytes = 0;
    for (const [key, stat] of Object.entries(stats)) {
      if (!stat) continue;
      rssBytes += stat.memory;
      this.accumulateCpu(stat.pid ?? Number(key), stat.ctime);
    }
    return rssBytes;
  }

  /**
   * Processes that were already running when the window opened report cumulative CPU time, so
   * their first observed value becomes the baseline. Processes spawned inside the window start at
   * zero, which also covers the CPU they burnt before the first sample reached them.
   */
  private accumulateCpu(pid: number, ctime: number): void {
    if (!this.cpuBaseline.has(pid)) {
      this.cpuBaseline.set(pid, pid === process.pid || this.tracker.isPreexisting(pid) ? ctime : 0);
    }
    const used = ctime - (this.cpuBaseline.get(pid) ?? 0);
    this.cpuByPid.set(pid, Math.max(this.cpuByPid.get(pid) ?? 0, used));
  }
}
