import * as fs from 'fs';
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

const canonicalRoots = new Map<string, string>();

/**
 * The CLI reports realpath'd repo roots (e.g. `/private/var/...` on macOS where VS Code sees `/var/...`,
 * or long names for Windows 8.3 short paths), so roots must be compared in their canonical form.
 * Resolved roots are cached since every review event is matched against one; failures are not, so a root
 * that does not exist yet resolves once it does.
 */
export function canonicalRepoRoot(repoRoot: string): string {
  const normalized = normalizeFsPath(repoRoot);
  const cached = canonicalRoots.get(normalized);
  if (cached !== undefined) return cached;
  try {
    const canonical = normalizeFsPath(fs.realpathSync.native(repoRoot));
    canonicalRoots.set(normalized, canonical);
    return canonical;
  } catch {
    return normalized;
  }
}

const localRepoRoots = new Map<string, string>();

/**
 * Records the form VS Code uses for a repo root so roots reported by the CLI can be mapped back to it.
 * Paths built from the CLI form would otherwise miss the open documents for that repo.
 */
export function rememberLocalRepoRoot(repoRoot: string): void {
  localRepoRoots.set(canonicalRepoRoot(repoRoot), repoRoot);
}

export function toLocalRepoRoot(reportedRoot: string): string {
  return localRepoRoots.get(canonicalRepoRoot(reportedRoot)) ?? reportedRoot;
}

export function pathsEqual(left: string, right: string): boolean {
  return normalizeFsPath(left) === normalizeFsPath(right) || canonicalRepoRoot(left) === canonicalRepoRoot(right);
}

/**
 * Both arguments must already be normalized with `normalizeFsPath`.
 */
export function isPathUnderRoot(normalizedRoot: string, normalizedPath: string): boolean {
  if (normalizedPath === normalizedRoot) return true;
  return normalizedPath.startsWith(normalizedRoot + path.sep) || normalizedPath.startsWith(`${normalizedRoot}/`);
}
