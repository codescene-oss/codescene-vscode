import { logOutputChannel } from '../log';
import { gitExecutor } from '../git-utils';
import { GitLocator } from './git-locator';

export function parseGitStatusFilename(line: string): string | null {
  // e.g. "MM src/foo.clj"
  const match = line.match(/^\S+\s+(.+)$/);

  if (!match?.[1]) {
    return null;
  }

  // Handle renames: "R  old -> new" becomes "new"
  const filename = match[1].includes(' -> ')
    ? match[1].split(' -> ')[1].trim()
    : match[1];

  return filename;
}

export async function getCommittedChanges(baseCommit: string, workspacePath: string): Promise<Set<string>> {
  const changedFiles = new Set<string>();

  if (!baseCommit) {
    return changedFiles;
  }

  logOutputChannel.info('Locating git binary for diff');
  const gitPath = await GitLocator.locate();
  logOutputChannel.info(`Using git binary at: ${gitPath}`);
  const result = await gitExecutor.execute(
    { command: gitPath, args: ['diff', '--name-only', `${baseCommit}...HEAD`], ignoreError: true, taskId: 'git' },
    { cwd: workspacePath }
  );

  if (result.exitCode === 0) {
    result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .forEach(file => {
        changedFiles.add(file);
      });
  } else {
    logOutputChannel.warn(`Failed to get committed changes vs ${baseCommit}: ${result.stderr}`);
  }

  return changedFiles;
}

export async function getStatusChanges(workspacePath: string): Promise<Set<string>> {
  const changedFiles = new Set<string>();

  logOutputChannel.info('Locating git binary for status');
  const gitPath = await GitLocator.locate();
  logOutputChannel.info(`Using git binary at: ${gitPath}`);
  const result = await gitExecutor.execute(
    // untracked-files is important - makes it return e.g. foo/bar.clj instead of foo/ for untracked files. Else we can produce unreliable results.
    { command: gitPath, args: ['status', '--porcelain', '--untracked-files=all'], ignoreError: true, taskId: 'git' },
    { cwd: workspacePath }
  );

  if (result.exitCode === 0) {
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
        if (filename) {
          changedFiles.add(filename);
        }
      });
  } else {
    logOutputChannel.info(`Failed to get status changes: ${result.stderr}`);
  }

  return changedFiles;
}
