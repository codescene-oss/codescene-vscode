import * as path from 'path';
import * as fs from 'fs';
import { logOutputChannel } from '../log';
import { gitExecutor } from '../git-utils';
import { markGitAsUnavailable } from './git-detection';

//  https://git-scm.com/docs/git#Documentation/git.txt---no-optional-locks
// Can help creating unnecessary index.lock files:
const GIT_ENV_NO_OPTIONAL_LOCKS = { GIT_OPTIONAL_LOCKS: "0" };

// Maximum number of untracked files allowed per location (root or directory)
// This has the purpose of ignoring abundant files that may have not been gitignored by the user yet.
// e.g. .clj-kondo/.cache/foo/bar.clj
export const MAX_UNTRACKED_FILES_PER_LOCATION = 5;

export function parseGitStatusFilename(line: string): string | null {
  // e.g. "MM src/foo.clj" or '?? "file with spaces.ts"'
  const match = line.match(/^\S+\s+(.+)$/);

  if (!match?.[1]) {
    return null;
  }

  // Handle renames: "R  old -> new" becomes "new"
  let filename = match[1].includes(' -> ')
    ? match[1].split(' -> ')[1].trim()
    : match[1];

  // Strip surrounding double-quotes if present (can happen for filenames with whitespace in them):
  if (filename.startsWith('"') && filename.endsWith('"')) {
    filename = filename.slice(1, -1);
  }

  return filename;
}

export function createWorkspacePrefix(workspacePath: string): { normalizedWorkspacePath: string; workspacePrefix: string } {
  const normalizedWorkspacePath = path.resolve(workspacePath);
  const workspacePrefix = normalizedWorkspacePath.endsWith(path.sep)
    ? normalizedWorkspacePath
    : normalizedWorkspacePath + path.sep;
  return { normalizedWorkspacePath, workspacePrefix };
}

export function isFileInWorkspace(
  file: string,
  gitRootPath: string,
  normalizedWorkspacePath: string,
  workspacePrefix: string
): boolean {
  const normalizedGitRootPath = path.normalize(gitRootPath);
  // Git returns paths relative to gitRootPath, so resolve them to absolute paths:
  // Normalize the file path to handle Git's forward slashes on all platforms
  const normalizedFile = path.normalize(file);
  const absolutePath = path.resolve(normalizedGitRootPath, normalizedFile);

  // Safety layer useful for misc purposes - I think that at times, despite our efforts, our Git parsing can return non-existing files:
  if (!fs.existsSync(absolutePath)) {
    return false;
  }

  // Only include files that are within the workspace:
  return absolutePath.startsWith(workspacePrefix) || absolutePath === normalizedWorkspacePath;
}

export function convertGitPathToAbsolutePath(
  file: string,
  gitRootPath: string
): string {
  const normalizedGitRootPath = path.normalize(gitRootPath);
  const normalizedFile = path.normalize(file);
  const absolutePath = path.resolve(normalizedGitRootPath, normalizedFile);
  return absolutePath;
}

export function convertGitPathToWorkspacePath(
  file: string,
  gitRootPath: string,
  normalizedWorkspacePath: string
): string {
  const absolutePath = convertGitPathToAbsolutePath(file, gitRootPath);
  const relativeToWorkspace = path.relative(normalizedWorkspacePath, absolutePath);
  return relativeToWorkspace;
}

export async function getCommittedChanges(gitRootPath: string, baseCommit: string, workspacePath: string): Promise<Set<string>> {
  const changedFiles = new Set<string>();

  if (!baseCommit) {
    return changedFiles;
  }

  const result = await gitExecutor.execute(
    { command: 'git', args: ['diff', '--name-only', `${baseCommit}...HEAD`], ignoreError: true, taskId: 'git' },
    { cwd: gitRootPath, env: GIT_ENV_NO_OPTIONAL_LOCKS }
  );

  if (result.exitCode === 0) {
    const { normalizedWorkspacePath, workspacePrefix } = createWorkspacePrefix(workspacePath);

    result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .forEach(file => {
        if (isFileInWorkspace(file, gitRootPath, normalizedWorkspacePath, workspacePrefix)) {
          const relativeToWorkspace = convertGitPathToWorkspacePath(file, gitRootPath, normalizedWorkspacePath);
          changedFiles.add(relativeToWorkspace);
        }
      });
  } else {
    if (result.exitCode === "ENOENT") {
      markGitAsUnavailable();
    }
    logOutputChannel.warn(`Failed to get committed changes vs ${baseCommit}: ${result.stderr}`);
  }

  return changedFiles;
}

// Returns a list of files from `git status`, while ignoring untracked files if too abundant
// (those probably are files that will be gitignored by the user later)
export async function getStatusChanges(gitRootPath: string, workspacePath: string, filesToExcludeFromHeuristic: Set<string>): Promise<Set<string>> {
  const changedFiles = new Set<string>();

  // First pass: run git status with --untracked-files=normal to detect untracked directories
  const normalResult = await gitExecutor.execute(
    { command: 'git', args: ['status', '--porcelain', '--untracked-files=normal'], ignoreError: true, taskId: 'git' },
    { cwd: gitRootPath, env: GIT_ENV_NO_OPTIONAL_LOCKS }
  );

  if (normalResult.exitCode !== 0) {
    if (normalResult.exitCode === "ENOENT") {
      markGitAsUnavailable();
    }
    logOutputChannel.info(`Failed to get status changes: ${normalResult.exitCode} ${normalResult.stderr}`);
    return changedFiles;
  }

  const untrackedDirectories = new Set<string>();
  const normalLines = normalResult.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  for (const line of normalLines) {
    if (line.startsWith('??')) {
      const filename = parseGitStatusFilename(line);
      if (filename) {
        if (filename.endsWith('/')) {
          untrackedDirectories.add(filename.slice(0, -1));
        }
      }
    }
  }

  // Second pass: run git status with --untracked-files=all *if* there were untracked directories
  // (this is an optimization to avoid calling git twice when not needed)
  let linesToParse = normalLines;
  if (untrackedDirectories.size > 0) {
    const allResult = await gitExecutor.execute(
      { command: 'git', args: ['status', '--porcelain', '--untracked-files=all'], ignoreError: true, taskId: 'git' },
      { cwd: gitRootPath, env: GIT_ENV_NO_OPTIONAL_LOCKS }
    );

    if (allResult.exitCode === 0) {
      linesToParse = allResult.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    }
  }

  const { normalizedWorkspacePath, workspacePrefix } = createWorkspacePrefix(workspacePath);

  const untrackedFilesByLocation = new Map<string, string[]>();

  for (const line of linesToParse) {
    const statusCodes = line.substring(0, 2).trim();
    const includedStatuses = ['A', 'M', 'R', 'C', 'AM', 'MM', '??'];
    if (!includedStatuses.includes(statusCodes)) {
      continue;
    }

    const filename = parseGitStatusFilename(line);
    if (!filename || !isFileInWorkspace(filename, gitRootPath, normalizedWorkspacePath, workspacePrefix)) {
      continue;
    }

    if (statusCodes === '??') {
      const dir = path.dirname(filename);
      const location = dir === '.' ? '__root__' : dir;

      if (!untrackedFilesByLocation.has(location)) {
        untrackedFilesByLocation.set(location, []);
      }
      untrackedFilesByLocation.get(location)!.push(filename);
    } else {
      const relativeToWorkspace = convertGitPathToWorkspacePath(filename, gitRootPath, normalizedWorkspacePath);
      changedFiles.add(relativeToWorkspace);
    }
  }

  for (const [location, files] of untrackedFilesByLocation) {
    const shouldExclude =
      (location === '__root__' && files.length > MAX_UNTRACKED_FILES_PER_LOCATION) ||
      (location !== '__root__' && untrackedDirectories.has(location) && files.length > MAX_UNTRACKED_FILES_PER_LOCATION);

    for (const filename of files) {
      const absolutePath = convertGitPathToAbsolutePath(filename, gitRootPath);
      const shouldExcludeFromHeuristic = filesToExcludeFromHeuristic.has(absolutePath);

      if (!shouldExclude || shouldExcludeFromHeuristic) {
        const relativeToWorkspace = convertGitPathToWorkspacePath(filename, gitRootPath, normalizedWorkspacePath);
        changedFiles.add(relativeToWorkspace);
      }
    }
  }

  return changedFiles;
}
