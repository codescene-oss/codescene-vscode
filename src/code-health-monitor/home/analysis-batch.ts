import { normalizeFsPath } from '../../utils/fs-paths';
import { analysisJobsToCwf } from './home-props-utils';

export function remainingJobCount(
  running?: Iterable<string>,
  queued?: string[],
  queueCount?: number
): number {
  const runningList = running ? [...running] : [];
  const queuedList = queued ?? [];
  const queuedKeys = new Set(queuedList.map(normalizeFsPath));
  const localOnly = runningList.filter((fileName) => !queuedKeys.has(normalizeFsPath(fileName))).length;
  const listed = analysisJobsToCwf(runningList, queuedList).length;
  return Math.max(listed, (queueCount ?? 0) + localOnly);
}

export class AnalysisBatchTracker {
  private total = 0;
  private lastRemaining = 0;

  update(remaining: number): { totalCount: number; remainingCount: number } {
    if (remaining <= 0) {
      this.reset();
      return { totalCount: 0, remainingCount: 0 };
    }
    if (this.total === 0) {
      this.total = remaining;
    } else if (remaining > this.lastRemaining) {
      this.total += remaining - this.lastRemaining;
    }
    this.lastRemaining = remaining;
    return { totalCount: this.total, remainingCount: remaining };
  }

  reset(): void {
    this.total = 0;
    this.lastRemaining = 0;
  }
}
