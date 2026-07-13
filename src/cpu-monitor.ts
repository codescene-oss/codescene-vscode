import * as os from 'os';

interface CpuSnapshot {
  idle: number;
  total: number;
}

export type CpuProvider = () => os.CpuInfo[];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let previousCpuInfo: CpuSnapshot[] = [];
let cpuProvider: CpuProvider = os.cpus;

export function setCpuProvider(provider: CpuProvider): void {
  cpuProvider = provider;
  previousCpuInfo = snapshotCpus();
}

export function resetCpuProvider(): void {
  cpuProvider = os.cpus;
  previousCpuInfo = snapshotCpus();
}

function snapshotCpus(): CpuSnapshot[] {
  return cpuProvider().map(cpu => {
    const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
    return { idle: cpu.times.idle, total };
  });
}

export async function isCpuTooBusy(): Promise<boolean> {
  const samples = 5;
  const sampleDelayMs = 12.5;
  let coreUsageSums: number[] = [];
  let coreCount = 0;

  for (let i = 0; i < samples; i++) {
    if (i > 0) {
      await sleep(sampleDelayMs);
    }

    const currentCpuInfo = snapshotCpus();
    if (i === 0) {
      coreCount = currentCpuInfo.length;
      coreUsageSums = new Array(coreCount).fill(0);
    }

    currentCpuInfo.forEach((current, index) => {
      const prev = previousCpuInfo[index];
      const idleDiff = current.idle - prev.idle;
      const totalDiff = current.total - prev.total;
      const usage = totalDiff > 0 ? 100 - ((100 * idleDiff) / totalDiff) : 0;
      coreUsageSums[index] += usage;
    });

    previousCpuInfo = currentCpuInfo;
  }

  const avgCoreUsages = coreUsageSums.map(sum => sum / samples);
  const averageUsage = avgCoreUsages.reduce((sum, usage) => sum + usage, 0) / avgCoreUsages.length;

  let threshold: number;
  if (coreCount >= 8) {
    threshold = 75;
  } else if (coreCount >= 4) {
    threshold = 70;
  } else {
    threshold = 65;
  }

  return averageUsage > threshold;
}

export async function getCpuUsages(): Promise<number[]> {
  const samples = 5;
  const sampleDelayMs = 12.5;
  let coreUsageSums: number[] = [];

  for (let i = 0; i < samples; i++) {
    if (i > 0) {
      await sleep(sampleDelayMs);
    }

    const currentCpuInfo = snapshotCpus();
    if (i === 0) {
      coreUsageSums = new Array(currentCpuInfo.length).fill(0);
    }

    currentCpuInfo.forEach((current, index) => {
      const prev = previousCpuInfo[index];
      const idleDiff = current.idle - prev.idle;
      const totalDiff = current.total - prev.total;
      const usage = totalDiff > 0 ? 100 - ((100 * idleDiff) / totalDiff) : 0;
      coreUsageSums[index] += usage;
    });

    previousCpuInfo = currentCpuInfo;
  }

  return coreUsageSums.map(sum => Math.round(sum / samples));
}

resetCpuProvider();
