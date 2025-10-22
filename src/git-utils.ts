import vscode from 'vscode';
import { GitExtension, Repository } from '../types/git';
import { SimpleExecutor } from './executor';
import { logOutputChannel } from './log';

const gitExecutor = new SimpleExecutor();
const gitFileDeleteEvent = new vscode.EventEmitter<string>();
export const onFileDeletedFromGit = gitFileDeleteEvent.event;

interface RepoState {
  branch: string | undefined;
  commit: string | undefined;
}

let repoState: RepoState;

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
export function isMainBranch(currentBranch: string | undefined) {
  if (!currentBranch) return false;

  const possibleMainBranches = ['main', 'master', 'develop', 'trunk', 'dev'];

  return possibleMainBranches.includes(currentBranch);
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

export interface GitStateChange {
  commitChanged: boolean,
  branchChanged: boolean
}

export function updateGitState(repo: Repository) : GitStateChange {
  const head = repo.state.HEAD;
  if (!head) return {commitChanged: false, branchChanged: false};
  
  const gitStateChange: GitStateChange = {
    commitChanged: repoState?.commit !== head.commit,
    branchChanged: repoState?.branch !== head.name
  };

  repoState = {
    commit: head.commit,
    branch: head.name,
  };
  return gitStateChange;
}
