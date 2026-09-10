import { FixtureFile } from './fixture-repo';

export interface QuiescenceOptions {
  settleMs: number;
  minWaitMs: number;
  timeoutMs: number;
  expectEvents: boolean;
}

const MAX_SCENARIO_MS = 2700000;

export const DEFAULT_QUIESCENCE: QuiescenceOptions = {
  settleMs: 2000,
  minWaitMs: 0,
  timeoutMs: MAX_SCENARIO_MS,
  expectEvents: true,
};

export const WATCH_QUIESCENCE: QuiescenceOptions = {
  settleMs: 5000,
  minWaitMs: 0,
  timeoutMs: 240000,
  expectEvents: true,
};

/**
 * Used after a git operation. Neither architecture is required to produce results, since a warm
 * cache can legitimately make the operation free, so this observes a fixed window instead.
 */
export const GIT_OBSERVE_QUIESCENCE: QuiescenceOptions = {
  settleMs: 5000,
  minWaitMs: 30000,
  timeoutMs: 300000,
  expectEvents: false,
};
export const WATCH_DRAIN_MS = 3000;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BenchmarkAdapter {
  readonly name: string;
  start(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  beginMeasurement(): void;
  enqueue(repoRoot: string, files: FixtureFile[]): Promise<void>;
  watch(repoRoot: string): Promise<void>;
  unwatch(repoRoot: string): Promise<void>;
  waitForQuiescence(options?: QuiescenceOptions): Promise<void>;
  latencies(): number[];
}
