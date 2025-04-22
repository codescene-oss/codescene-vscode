import vscode from 'vscode';
import { GitExtension, Repository } from '../types/git';
import { SimpleExecutor } from './executor';
import { logOutputChannel } from './log';
import Reviewer from './review/reviewer';

const gitExecutor = new SimpleExecutor();
const gitFileDeleteEvent = new vscode.EventEmitter<string>();
export const onFileDeletedFromGit = gitFileDeleteEvent.event;

export function acquireGitApi() {
  const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports as GitExtension;
  if (!gitExtension) {
    void vscode.window.showErrorMessage(
      'Unable to load vscode.git extension. Code Health Monitor will be unavailable.'
    );
    return;
  }
  return gitExtension.getAPI(1);
}

export async function removeStaleFiles(repo: Repository, currentBaseline: string | undefined) {
  const files = await getFilesNotInBranch({
    currentBranch: repo.state.HEAD?.name,
    repositoryPath: repo.rootUri.path,
    currentBaseline,
  });

  files.forEach((file) => {
    handleFileDeletion(file);
  });
}

interface FilesNotInBranchArgs {
  currentBranch: string | undefined;
  repositoryPath: string;
  currentBaseline: string | undefined;
}

export async function getFilesNotInBranch({
  currentBranch,
  repositoryPath,
  currentBaseline,
}: FilesNotInBranchArgs): Promise<string[]> {
  try {
    const previousBranch = await getPreviousBranch(repositoryPath);
    if (!previousBranch || !currentBaseline) return [];

    const { stdout: diff } = await gitExecutor.execute(
      { command: 'git', args: ['diff', '--name-only', '--diff-filter=D', `${previousBranch}..${currentBranch}`] },
      { cwd: repositoryPath }
    );

    if (!diff) return [];
    else
      return diff
        .split('\n')
        .filter((file) => file)
        .map((file) => `${repositoryPath}/${file}`);
  } catch (error) {
    logOutputChannel.error(`Could not obtain files currently not in branch: ${error}`);
    return [];
  }
}

/**
 * Retrieves the commit hash where the current branch was created from, by checking
 * the git reflog.
 *
 * If the current branch is main, defaults to comparing to perfect score (10.0).
 */
export async function getBranchCreationCommit(repo: Repository) {
  const currentBranch = repo.state.HEAD?.name;
  const repoPath = repo.rootUri.path;
  if (!currentBranch || !repoPath) return '';

  if (await isMainBranch({ currentBranch, repoPath })) return '';

  try {
    const { stdout: reflog } = await gitExecutor.execute(
      { command: 'git', args: ['reflog', currentBranch, '--no-abbrev'] },
      { cwd: repoPath }
    );

    const CREATION_KEYWORD = 'created from';

    const creationLine = reflog
      .split('\n')
      .reverse()
      .find((line) => line.toLowerCase().includes(CREATION_KEYWORD));

    return creationLine?.split(' ')?.[0] ?? '';
  } catch (err) {
    logOutputChannel.error(`Could not get branch creation point for file ${repo.rootUri.fsPath}: ${err}`);
    return '';
  }
}

interface IsMainBranchArgs {
  currentBranch: string | undefined;
  repoPath: string;
}
/**
 * Determines if the given branch could be the default branch.
 *
 * Checks against a list of commonly used default branch names (main, master, develop, trunk),
 * and also compares with the actual default branch retrieved from the remote (if any).
 */
export async function isMainBranch({ currentBranch, repoPath }: IsMainBranchArgs) {
  if (!currentBranch) return false;

  const possibleMainBranches = ['main', 'master', 'develop', 'trunk'];
  const defaultBranch = await getPossibleDefaultBranchName(repoPath);

  return currentBranch === defaultBranch || possibleMainBranches.includes(currentBranch);
}

/**
 * Retrieves the default branch name of the remote origin.
 *
 * Parses the output of `git remote show origin` to extract the HEAD branch name.
 */
async function getPossibleDefaultBranchName(repositoryPath: string) {
  try {
    const { stdout } = await gitExecutor.execute(
      { command: 'git', args: ['remote', 'show', 'origin'] },
      { cwd: repositoryPath }
    );

    return stdout
      .split('\n')
      .find((line) => line.includes('HEAD branch:'))
      ?.split(':')?.[1]
      ?.trim();
  } catch (err) {
    logOutputChannel.error(`Error occurred while retrieving default branch for repository ${repositoryPath}: ${err}`);
  }
}

/**
 * Handles the deletion of a file from the repository.
 *
 * Removes the file's review data from the review cache
 * and fires a Git file delete event for consumers (Code Health Monitor tree).
 */
export function handleFileDeletion(fileUri: string) {
  Reviewer.instance.reviewCache.delete(fileUri);

  gitFileDeleteEvent.fire(fileUri);
}

/**
 * Retrieves the latest commit hashes from the repository.
 */
export async function getLatestCommits(repo: Repository, amount: number = 2) {
  try {
    const result = await repo.log({ maxEntries: amount });

    return result.map((res) => res.hash);
  } catch (err) {
    logOutputChannel.error(`Unable to get latest ${amount} commits for ${repo?.rootUri.path}: ${err}`);
    return [];
  }
}

/**
 * Attempts to determine the previously checked-out Git branch
 * by inspecting the most recent entry in the reflog.
 */
async function getPreviousBranch(repositoryPath: string) {
  const { stdout: reflog } = await gitExecutor.execute(
    { command: 'git', args: ['reflog', '-1'] },
    { cwd: repositoryPath }
  );

  const match = reflog.match(/checkout: moving from ([^ ]+) to /);
  return match ? match[1] : null;
}

interface ResetBaselineArgs {
  prevRef: string;
  headRef: string;
  repo: Repository;
}
/**
 * Resets the baseline for files changed between two Git references, when baseline is set to HEAD.
 *
 * If a file was deleted (status 6), it triggers file deletion handling.
 * For all changed files, it resets their baseline in the review cache.
 */
export async function resetBaselineForFilesChanged({ prevRef, headRef, repo }: ResetBaselineArgs) {
  if (headRef && prevRef) {
    const changes = await repo.diffBetween(prevRef, headRef);

    changes.forEach((change) => {
      if (change.status === 6) {
        handleFileDeletion(change.uri.fsPath);
      }
      Reviewer.instance.reviewCache.resetBaseline(change.uri.fsPath);
    });
  }
}
