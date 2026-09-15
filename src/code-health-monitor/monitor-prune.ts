import { getHomeViewInstance } from './home/home-view';
import { isPathUnderRoot, normalizeFsPath } from '../utils/fs-paths';

const NO_PATHS: Set<string> = new Set();

/**
 * Drops every monitored file under `repoRoots` that is outside `keepPaths`. The CLI only reports
 * files that are in the change set, so anything else under a repository it has reported on has
 * either left the change set or was never part of it. Repositories without a reported inventory
 * are left alone, since nothing is known about them yet.
 */
export function pruneMonitorToPaths(repoRoots: string[], keepPaths: Set<string>): void {
  const homeView = getHomeViewInstance();
  if (!homeView) return;
  const monitored = homeView.getFileIssueMap().keys();
  homeView.removeStaleFiles(keepWithUnscopedFiles(monitored, repoRoots, keepPaths), NO_PATHS, NO_PATHS);
}

export function keepWithUnscopedFiles(
  monitored: Iterable<string>,
  repoRoots: string[],
  keepPaths: Set<string>
): Set<string> {
  const roots = repoRoots.map(normalizeFsPath);
  const keep = new Set(keepPaths);
  for (const filePath of monitored) {
    const normalized = normalizeFsPath(filePath);
    if (!roots.some((root) => isPathUnderRoot(root, normalized))) keep.add(filePath);
  }
  return keep;
}
