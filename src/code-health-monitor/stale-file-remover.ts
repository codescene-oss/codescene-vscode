import * as path from 'path';

export class StaleFileRemover {
  private isPathInSet(filePath: string, pathSet: Set<string>): boolean {
    const normalized = path.normalize(filePath);
    for (const p of pathSet) {
      if (path.normalize(p) === normalized) return true;
    }
    return false;
  }

  private isPathInAnySets(filePath: string, sets: Set<string>[]): boolean {
    return sets.some((set) => this.isPathInSet(filePath, set));
  }

  findStaleFiles(
    fileIssueMap: Map<string, unknown>,
    changedFiles: Set<string>,
    visibleFiles: Set<string>,
    filesInJob: Set<string>
  ): string[] {
    const stalePaths: string[] = [];
    const activeSets = [changedFiles, visibleFiles, filesInJob];
    for (const filePath of fileIssueMap.keys()) {
      if (!this.isPathInAnySets(filePath, activeSets)) {
        stalePaths.push(filePath);
      }
    }
    return stalePaths;
  }
}
