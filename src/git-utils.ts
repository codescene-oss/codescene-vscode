/* eslint-disable @typescript-eslint/naming-convention */
import path from 'path';
import vscode from 'vscode';
import { GitExtension, Repository } from '../types/git';
import { QueuedSingleTaskExecutor } from './queued-single-task-executor';
import { logOutputChannel } from './log';
import { markGitAsUnavailable } from './git/git-detection';

export const GIT_TASK_ID = 'git';
export const gitExecutor = new QueuedSingleTaskExecutor();
const gitFileDeleteEvent = new vscode.EventEmitter<string>();
export const onFileDeletedFromGit = gitFileDeleteEvent.event;
export const fireFileDeletedFromGit = (filePath: string) => gitFileDeleteEvent.fire(filePath);

function isEnoentError(err: unknown): boolean {
  return (err as any)?.code === 'ENOENT';
}

interface RepoState {
  branch: string | undefined;
  commit: string | undefined;
}

let repoState: RepoState;

export function acquireGitApi() {
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports as GitExtension;
    if (!gitExtension) throw Error('Git extension not available.');

    return gitExtension.getAPI(1);
  } catch (error) {
    const message = 'Unable to load vscode.git extension. Code Health Monitor will be unavailable.';

    logOutputChannel.warn(message);
    void vscode.window.showErrorMessage(message);

    return;
  }
}

export function getRepoRootPath(repo: Repository): string {
  const fsPath = repo.rootUri.fsPath;
  return path.normalize(fsPath);
}

export function getWorkspacePath(workspaceFolder: vscode.WorkspaceFolder): string {
  const fsPath = workspaceFolder.uri.fsPath;
  return path.normalize(fsPath);
}

const mainBranchCandidatesCache = new Map<string, string[]>();

/**
 * Returns the branch names that look like the main branch AND do in fact exist.
 */
export async function getMainBranchCandidates(repoPath: string): Promise<string[]> {
  const cached = mainBranchCandidatesCache.get(repoPath);
  if (cached) {
    return cached;
  }

  const possibleMainBranches = ['main', 'master', 'develop', 'trunk', 'dev'];

  try {
    const { stdout, stderr, exitCode } = await gitExecutor.execute(
      { command: 'git', args: ['branch', '--list', '--format=%(refname:short)'], taskId: GIT_TASK_ID },
      { cwd: repoPath }
    );

    if (exitCode !== 0) {
      if (exitCode === "ENOENT") {
        markGitAsUnavailable();
      }
      logOutputChannel.error(`Could not get local branches for ${repoPath} (exit code ${exitCode}): ${stderr}`);
      return [];
    }

    const localBranches = stdout.split('\n').map(branch => branch.trim()).filter(Boolean);
    const result = possibleMainBranches.filter(branch => localBranches.includes(branch));
    mainBranchCandidatesCache.set(repoPath, result);
    return result;
  } catch (err) {
    if (isEnoentError(err)) {
      markGitAsUnavailable();
    }
    logOutputChannel.error(`Could not get local branches for ${repoPath}: ${err}`);
    return [];
  }
}

/**
 * Determines if the given branch could be the default branch.
 *
 * Checks against locally present main branch names (main, master, develop, trunk, dev).
 */
export async function isMainBranch(currentBranch: string | undefined, repoPath: string): Promise<boolean> {
  if (!currentBranch) return false;

  const localMainBranches = await getMainBranchCandidates(repoPath);
  return localMainBranches.includes(currentBranch);
}

/**
 * Determines the merge-base commit.
 *
 * If we're on the main branch, returns the HEAD commit.
 * If we're on a non-main branch, returns the merge-base commit between the current branch and the main branch.
 */
export async function getMergeBaseCommit(repo: Repository): Promise<string> {
  const currentBranch = repo.state.HEAD?.name;
  const repoPath = getRepoRootPath(repo);

  if (!currentBranch || !repoPath) {
    return '';
  }

  const isMain = await isMainBranch(currentBranch, repoPath);

  if (isMain) {
    const commit = repo.state.HEAD?.commit || '';
    return commit;
  }

  const localMainBranches = await getMainBranchCandidates(repoPath);
  for (const mainBranch of localMainBranches) {
    try {
      const { stdout: mergeBase, stderr, exitCode } = await gitExecutor.execute(
        { command: 'git', args: ['merge-base', currentBranch, mainBranch], taskId: GIT_TASK_ID },
        { cwd: repoPath }
      );

      if (exitCode !== 0) {
        if (exitCode === "ENOENT") {
          markGitAsUnavailable();
        }
        logOutputChannel.error(`Could not get merge-base for ${currentBranch} and ${mainBranch} (exit code ${exitCode}): ${stderr}`);
        continue;
      }

      const commit = mergeBase.trim();
      if (commit) {
        return commit;
      }
    } catch (err) {
      if (isEnoentError(err)) {
        markGitAsUnavailable();
      }
      logOutputChannel.error(`${err}`);
      continue;
    }
  }

  return '';
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

export function deactivate() {
  gitFileDeleteEvent.dispose();
}
