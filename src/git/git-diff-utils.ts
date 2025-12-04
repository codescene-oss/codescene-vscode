import * as path from 'path';
import { logOutputChannel } from '../log';
import { gitExecutor } from '../git-utils';
import { markGitAsUnavailable } from './git-detection';

//  https://git-scm.com/docs/git#Documentation/git.txt---no-optional-locks
// Can help creating unnecessary index.lock files:
const GIT_ENV_NO_OPTIONAL_LOCKS = { GIT_OPTIONAL_LOCKS: "0" };

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
  // Only include files that are within the workspace:
  return absolutePath.startsWith(workspacePrefix) || absolutePath === normalizedWorkspacePath;
}

export function convertGitPathToWorkspacePath(
  file: string,
  gitRootPath: string,
  normalizedWorkspacePath: string
): string {
  // Git returns paths relative to gitRootPath. Convert to absolute, then make relative to workspacePath:
  const normalizedGitRootPath = path.normalize(gitRootPath);
  const normalizedFile = path.normalize(file);
  const absolutePath = path.resolve(normalizedGitRootPath, normalizedFile);
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

export async function getStatusChanges(gitRootPath: string, workspacePath: string): Promise<Set<string>> {
  const changedFiles = new Set<string>();

  const result = await gitExecutor.execute(
    // untracked-files is important - makes it return e.g. foo/bar.clj instead of foo/ for untracked files. Else we can produce unreliable results.
    { command: 'git', args: ['status', '--porcelain', '--untracked-files=all'], ignoreError: true, taskId: 'git' },
    { cwd: gitRootPath, env: GIT_ENV_NO_OPTIONAL_LOCKS }
  );

  if (result.exitCode === 0) {
    const { normalizedWorkspacePath, workspacePrefix } = createWorkspacePrefix(workspacePath);

    result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => {
        // Only include created and modified files.
        // Include: A (added), M (modified), R (renamed), C (copied), ? (untracked)
        // Exclude: deletions (not needed for our use cases) and merge conflicts (we don't want to review broken files)
        const statusCodes = line.substring(0, 2).trim();
        const includedStatuses = ['A', 'M', 'R', 'C', 'AM', 'MM', '??'];
        return includedStatuses.includes(statusCodes);
      })
      .forEach(line => {
        const filename = parseGitStatusFilename(line);
        if (filename && isFileInWorkspace(filename, gitRootPath, normalizedWorkspacePath, workspacePrefix)) {
          const relativeToWorkspace = convertGitPathToWorkspacePath(filename, gitRootPath, normalizedWorkspacePath);
          changedFiles.add(relativeToWorkspace);
        }
      });
  } else {
    if (result.exitCode === "ENOENT") {
      markGitAsUnavailable();
    }
    logOutputChannel.info(`Failed to get status changes: ${result.exitCode} ${result.stderr}`);
  }

  return changedFiles;
}
