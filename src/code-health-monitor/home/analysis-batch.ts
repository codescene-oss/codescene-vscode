import { localJobsMissingFromProgress } from './home-props-utils';

export function monitorJobCounts(
  running?: Iterable<string>,
  queued?: string[],
  queueCount?: number,
  queueDone?: number,
  repoRoots: readonly string[] = []
): { totalCount: number; remainingCount: number } {
  const localOnly = localJobsMissingFromProgress(running, queued ?? [], repoRoots).length;
  const remainingCount = (queueCount ?? 0) + localOnly;
  if (remainingCount <= 0) return { totalCount: 0, remainingCount: 0 };
  return { totalCount: (queueDone ?? 0) + remainingCount, remainingCount };
}
