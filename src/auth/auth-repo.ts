import * as path from 'path';
import { isPathUnderRoot, normalizeFsPath } from '../utils/fs-paths';
import type { AuthRepo } from './auth-payload';

function rootForFile(repoRoots: readonly string[], file: string | undefined): string | undefined {
  if (!file) return undefined;
  const normalizedFile = normalizeFsPath(file);
  return repoRoots
    .filter((root) => isPathUnderRoot(normalizeFsPath(root), normalizedFile))
    .sort((left, right) => right.length - left.length)[0];
}

export function pickRepo(repoRoots: readonly string[], activeFile: string | undefined): AuthRepo | null {
  const root = rootForFile(repoRoots, activeFile) ?? repoRoots[0];
  return root ? { path: root, name: path.basename(root) } : null;
}
