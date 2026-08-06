import * as path from 'path';

export function normalizeFsPath(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function toPosixRelPath(relPath: string): string {
  return relPath.split(path.sep).join('/').replace(/\\/g, '/');
}

export function relativePosix(from: string, to: string): string {
  return toPosixRelPath(path.relative(from, to));
}

export function pathsEqual(left: string, right: string): boolean {
  return normalizeFsPath(left) === normalizeFsPath(right);
}
