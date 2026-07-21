import * as path from 'path';

export class StaleFileRemover {
  private isPathInSet(filePath: string, pathSet: Set<string>): boolean {
    const normalized = path.normalize(filePath);
    for (const p of pathSet) {
      if (path.normalize(p) === normalized) return true;
    }
    return false;
  }

  findStaleFiles(
    fileIssueMap: Map<string, unknown>,
    changedFiles: Set<string>,
    visibleFiles: Set<string>
  ): string[] {
    const stalePaths: string[] = [];
    for (const filePath of fileIssueMap.keys()) {
      if (!this.isPathInSet(filePath, changedFiles) && !this.isPathInSet(filePath, visibleFiles)) {
        stalePaths.push(filePath);
      }
    }
    return stalePaths;
  }
}
