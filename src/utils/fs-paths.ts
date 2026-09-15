import * as path from 'path';

function isWindowsStylePath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath);
}

export function normalizeFsPath(filePath: string): string {
  if (process.platform === 'win32' || isWindowsStylePath(filePath)) {
    return path.win32.normalize(filePath).toLowerCase();
  }
  return path.normalize(filePath);
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

/**
 * Both arguments must already be normalized with `normalizeFsPath`.
 */
export function isPathUnderRoot(normalizedRoot: string, normalizedPath: string): boolean {
  if (normalizedPath === normalizedRoot) return true;
  return normalizedPath.startsWith(normalizedRoot + path.sep) || normalizedPath.startsWith(`${normalizedRoot}/`);
}
