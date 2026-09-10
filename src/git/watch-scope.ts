import { isPathUnderRoot, normalizeFsPath, relativePosix } from '../utils/fs-paths';

export type WatchScope = { kind: 'whole-repo' } | { kind: 'paths'; relativePaths: string[] };

export interface WatchScopeFolder {
  uri: { fsPath: string };
}

interface ComparablePath {
  original: string;
  normalized: string;
}

export function watchScopes(
  repoRoots: readonly string[],
  folders: readonly WatchScopeFolder[]
): Map<string, WatchScope> {
  const roots = repoRoots.map(comparablePath);
  const folderPaths = folders.map((folder) => comparablePath(folder.uri.fsPath));
  const scopes = new Map<string, WatchScope>();
  for (const root of roots) {
    const scope = scopeForRoot(root, roots, folderPaths);
    if (scope) scopes.set(root.normalized, scope);
  }
  return scopes;
}

export function watchScopePaths(scope: WatchScope): string[] | undefined {
  return scope.kind === 'paths' ? scope.relativePaths : undefined;
}

export function watchScopeKey(scope: WatchScope): string {
  return scope.kind === 'whole-repo' ? '.' : scope.relativePaths.join('\n');
}

function scopeForRoot(
  root: ComparablePath,
  roots: readonly ComparablePath[],
  folders: readonly ComparablePath[]
): WatchScope | undefined {
  const relativePaths: string[] = [];
  for (const folder of folders) {
    if (isPathUnderRoot(folder.normalized, root.normalized)) return { kind: 'whole-repo' };
    if (nearestRoot(roots, folder)?.normalized !== root.normalized) continue;
    relativePaths.push(relativePosix(root.original, folder.original));
  }
  if (relativePaths.length === 0) return undefined;
  return { kind: 'paths', relativePaths: collapseNested(relativePaths) };
}

function nearestRoot(roots: readonly ComparablePath[], folder: ComparablePath): ComparablePath | undefined {
  return roots
    .filter((root) => isPathUnderRoot(root.normalized, folder.normalized))
    .reduce<ComparablePath | undefined>(
      (nearest, root) => (!nearest || root.normalized.length > nearest.normalized.length ? root : nearest),
      undefined
    );
}

function collapseNested(relativePaths: string[]): string[] {
  const unique = Array.from(new Set(relativePaths)).sort();
  return unique.filter((candidate, index) => !unique.slice(0, index).some((earlier) => isUnder(earlier, candidate)));
}

function isUnder(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function comparablePath(filePath: string): ComparablePath {
  return { original: filePath, normalized: normalizeFsPath(filePath) };
}
