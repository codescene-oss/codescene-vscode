import * as fs from 'fs';
import * as path from 'path';
import { ResourceSample } from './process-metrics';
import { ScenarioResult } from './scenarios';

export interface Measurement {
  wallMs: number;
  resultCount: number;
  p95LatencyMs: number;
  cliCpuMs: number;
  extensionCpuMs: number;
  peakRssMb: number;
  processCount: number;
  childWallMs: number;
}

export interface ScenarioReport {
  id: string;
  description: string;
  fileCount: number;
  iterations: Measurement[];
  median: Measurement;
}

export interface BenchmarkEnvironment {
  platform: string;
  arch: string;
  cpus: number;
  nodeVersion: string;
}

export interface BenchmarkReport {
  adapter: string;
  createdAt: string;
  environment: BenchmarkEnvironment;
  scenarios: ScenarioReport[];
}

export interface BenchmarkEntry {
  name: string;
  unit: string;
  value: number;
  extra: string;
}

const METRIC_UNITS: Array<{ key: keyof Measurement; label: string; unit: string }> = [
  { key: 'wallMs', label: 'wall time', unit: 'ms' },
  { key: 'p95LatencyMs', label: 'p95 file latency', unit: 'ms' },
  { key: 'childWallMs', label: 'cli busy time', unit: 'ms' },
  { key: 'cliCpuMs', label: 'cli cpu time', unit: 'ms' },
  { key: 'extensionCpuMs', label: 'extension cpu time', unit: 'ms' },
  { key: 'peakRssMb', label: 'peak memory', unit: 'MB' },
  { key: 'processCount', label: 'cli processes', unit: 'count' },
];

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function measurementOf(sample: ResourceSample, result: ScenarioResult): Measurement {
  return {
    wallMs: result.latencies.length > 0 ? Math.max(...result.latencies) : 0,
    resultCount: result.latencies.length,
    p95LatencyMs: percentile(result.latencies, 0.95),
    cliCpuMs: sample.cliCpuMs,
    extensionCpuMs: sample.harnessCpuMs,
    peakRssMb: Math.round(sample.peakRssMb * 100) / 100,
    processCount: sample.processCount,
    childWallMs: sample.childWallMs,
  };
}

export function medianMeasurement(measurements: Measurement[]): Measurement {
  const pick = (key: keyof Measurement) => median(measurements.map((measurement) => measurement[key]));
  return {
    wallMs: pick('wallMs'),
    resultCount: pick('resultCount'),
    p95LatencyMs: pick('p95LatencyMs'),
    cliCpuMs: pick('cliCpuMs'),
    extensionCpuMs: pick('extensionCpuMs'),
    peakRssMb: pick('peakRssMb'),
    processCount: pick('processCount'),
    childWallMs: pick('childWallMs'),
  };
}

export function benchmarkEntries(report: BenchmarkReport): BenchmarkEntry[] {
  return report.scenarios.flatMap((scenario) =>
    METRIC_UNITS.map(({ key, label, unit }) => ({
      name: `${scenario.id} / ${label}`,
      unit,
      value: scenario.median[key],
      extra: `${scenario.description} (${scenario.fileCount} files, ${scenario.median.resultCount} results delivered, median of ${scenario.iterations.length})`,
    }))
  );
}

export function writeReport(report: BenchmarkReport, outputDir: string): void {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'benchmark-results.json'), `${JSON.stringify(benchmarkEntries(report), null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, `${report.adapter}.json`), `${JSON.stringify(report, null, 2)}\n`);
}
