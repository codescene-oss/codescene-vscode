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

  const possibleMainBranches = ['main', 'master', 'develop', 'trunk', 'dev', 'development'];

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
 * Checks against locally present main branch names (main, master, develop, trunk, dev, development).
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
  const candidateCommits = await collectMergeBaseCandidates(currentBranch, localMainBranches, repoPath);

  return pickBaselineFromCandidates(candidateCommits, repoPath);
}

function pickBaselineFromCandidates(candidateCommits: string[], repoPath: string): Promise<string> | string {
  if (candidateCommits.length === 0) return '';
  if (candidateCommits.length === 1) return candidateCommits[0];
  return selectClosestMergeBase(candidateCommits, repoPath);
}

async function mergeBaseWith(currentBranch: string, mainBranch: string, repoPath: string): Promise<string | undefined> {
  try {
    const { stdout: mergeBase, stderr, exitCode } = await gitExecutor.execute(
      { command: 'git', args: ['merge-base', currentBranch, mainBranch], taskId: GIT_TASK_ID },
      { cwd: repoPath }
    );

    if (exitCode !== 0) {
      if (exitCode === "ENOENT") markGitAsUnavailable();
      logOutputChannel.error(`Could not get merge-base for ${currentBranch} and ${mainBranch} (exit code ${exitCode}): ${stderr}`);
      return undefined;
    }

    return mergeBase.trim() || undefined;
  } catch (err) {
    if (isEnoentError(err)) markGitAsUnavailable();
    logOutputChannel.error(`${err}`);
    return undefined;
  }
}

async function collectMergeBaseCandidates(currentBranch: string, mainBranches: string[], repoPath: string): Promise<string[]> {
  const candidates: string[] = [];
  for (const mainBranch of mainBranches) {
    const commit = await mergeBaseWith(currentBranch, mainBranch, repoPath);
    if (commit && !candidates.includes(commit)) {
      candidates.push(commit);
    }
  }
  return candidates;
}

async function isAncestor(ancestor: string, descendant: string, repoPath: string): Promise<boolean | undefined> {
  try {
    const { exitCode } = await gitExecutor.execute(
      { command: 'git', args: ['merge-base', '--is-ancestor', ancestor, descendant], taskId: GIT_TASK_ID, ignoreError: true },
      { cwd: repoPath }
    );

    if (exitCode === "ENOENT") {
      markGitAsUnavailable();
      return undefined;
    }

    return exitCode === 0;
  } catch (err) {
    if (isEnoentError(err)) {
      markGitAsUnavailable();
    }
    logOutputChannel.error(`${err}`);
    return undefined;
  }
}

async function isDescendantOfAll(candidate: string, candidates: string[], repoPath: string): Promise<boolean | undefined> {
  for (const other of candidates) {
    if (candidate === other) continue;

    const result = await isAncestor(other, candidate, repoPath);
    if (result === undefined) return undefined;
    if (!result) return false;
  }
  return true;
}

/**
 * Given multiple merge-base candidates, returns the one closest to HEAD.
 *
 * The closest merge-base is the descendant of all other candidates, i.e. the
 * commit where every other candidate is an ancestor. Falls back to the first
 * candidate if the selection cannot be resolved.
 */
async function selectClosestMergeBase(candidateCommits: string[], repoPath: string): Promise<string> {
  for (const candidate of candidateCommits) {
    const descendantOfAll = await isDescendantOfAll(candidate, candidateCommits, repoPath);
    if (descendantOfAll === undefined) return candidateCommits[0];
    if (descendantOfAll) return candidate;
  }

  return candidateCommits[0];
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
