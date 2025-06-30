import vscode from 'vscode';
import { GitExtension, Repository } from '../types/git';
import { SimpleExecutor } from './executor';
import { logOutputChannel } from './log';
import Reviewer from './review/reviewer';

const gitExecutor = new SimpleExecutor();
const gitFileDeleteEvent = new vscode.EventEmitter<string>();
export const onFileDeletedFromGit = gitFileDeleteEvent.event;

export let repoState: {
  branch: string | undefined;
  commit: string | undefined;
};

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

  if (isMainBranch(currentBranch)) return '';

  try {
    const { stdout: reflog } = await gitExecutor.execute(
      { command: 'git', args: ['reflog', currentBranch, '--no-abbrev'] },
      { cwd: repoPath }
    );

    const creationKeyword = 'created from';

    const creationLine = reflog
      .split('\n')
      .reverse()
      .find((line) => line.toLowerCase().includes(creationKeyword));

    return creationLine?.split(' ')?.[0] ?? '';
  } catch (err) {
    logOutputChannel.error(`Could not get branch creation point for file ${repo.rootUri.fsPath}: ${err}`);
    return '';
  }
}

/**
 * Determines if the given branch could be the default branch.
 *
 * Checks against a list of commonly used default branch names (main, master, develop, trunk, dev).
 */
export function isMainBranch(currentBranch: string) {
  if (!currentBranch) return false;

  const possibleMainBranches = ['main', 'master', 'develop', 'trunk', 'dev'];

  return possibleMainBranches.includes(currentBranch);
}

/**
 * Handles the deletion of a file from the repository.
s *
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

export function updateGitState(repo: Repository) {
  const head = repo.state.HEAD;
  if (!head) return;

  const hasRepoChanged = repoState?.commit !== head.commit;
  if (!hasRepoChanged) {
    return;
  }

  repoState = {
    commit: head.commit,
    branch: head.name,
  };
}
