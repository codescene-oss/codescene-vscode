import * as path from 'path';
import { isPathUnderRoot, normalizeFsPath } from '../utils/fs-paths';
import type { AuthRepo } from './auth-payload';

function outermostRoots(repoRoots: readonly string[]): string[] {
  const normalized = repoRoots.map(normalizeFsPath);
  const isNested = (index: number) =>
    normalized.some((other, otherIndex) => other !== normalized[index] && isPathUnderRoot(other, normalized[index]));
  return repoRoots.filter((_, index) => !isNested(index));
}

function rootForFile(repoRoots: readonly string[], file: string | undefined): string | undefined {
  if (!file) return undefined;
  const normalizedFile = normalizeFsPath(file);
  return repoRoots.find((root) => isPathUnderRoot(normalizeFsPath(root), normalizedFile));
}

export function pickRepo(repoRoots: readonly string[], activeFile: string | undefined): AuthRepo | null {
  const outermost = outermostRoots(repoRoots);
  const root = rootForFile(outermost, activeFile) ?? outermost[0];
  return root ? { path: root, name: path.basename(root) } : null;
}
