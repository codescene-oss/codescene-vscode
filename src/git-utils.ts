/* eslint-disable @typescript-eslint/naming-convention */
import path from 'path';
import vscode from 'vscode';
import { GitExtension, Repository } from '../types/git';
import { QueuedSingleTaskExecutor } from './queued-single-task-executor';
import { logOutputChannel } from './log';
import { markGitAsUnavailable } from './git/git-detection';
import { getBaselineBranch } from './git/codescene-repo-config';

export const GIT_TASK_ID = 'git';
export const gitExecutor = new QueuedSingleTaskExecutor();
const gitFileDeleteEvent = new vscode.EventEmitter<string>();
export const onFileDeletedFromGit = gitFileDeleteEvent.event;
export const fireFileDeletedFromGit = (filePath: string) => gitFileDeleteEvent.fire(filePath);

const POSSIBLE_MAIN_BRANCHES = ['main', 'master', 'develop', 'trunk', 'dev', 'development'];
const ORIGIN_HEAD_REF = 'refs/remotes/origin/HEAD';
const ORIGIN_REMOTE_PREFIX = 'refs/remotes/origin/';

function isEnoentError(err: unknown): boolean {
  return (err as any)?.code === 'ENOENT';
}

function branchesEqual(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

export function isSafeRefName(ref: string): boolean {
  if (!ref || !ref.trim()) return false;
  if (ref.startsWith('-')) return false;
  return /^[A-Za-z0-9._/\-]+$/.test(ref);
}

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
const defaultBranchCache = new Map<string, string | undefined>();

export function clearMainBranchCandidatesCache(gitRootPath?: string): void {
  if (!gitRootPath) {
    mainBranchCandidatesCache.clear();
    defaultBranchCache.clear();
    return;
  }
  const normalizedPath = path.normalize(gitRootPath);
  mainBranchCandidatesCache.delete(normalizedPath);
  defaultBranchCache.delete(normalizedPath);
}

/**
 * Resolves the repository default branch: config baseline_branch, then origin/HEAD, then undefined.
 */
export async function getDefaultBranch(repoPath: string): Promise<string | undefined> {
  const normalizedPath = path.normalize(repoPath);

  if (defaultBranchCache.has(normalizedPath)) {
    return defaultBranchCache.get(normalizedPath);
  }

  const configured = getBaselineBranch(normalizedPath);
  if (configured) {
    defaultBranchCache.set(normalizedPath, configured);
    return configured;
  }

  try {
    const { stdout, exitCode } = await gitExecutor.execute(
      { command: 'git', args: ['symbolic-ref', ORIGIN_HEAD_REF], taskId: GIT_TASK_ID },
      { cwd: normalizedPath }
    );

    if (exitCode !== 0) {
      defaultBranchCache.set(normalizedPath, undefined);
      return undefined;
    }

    const target = stdout.trim();
    if (target.startsWith(ORIGIN_REMOTE_PREFIX)) {
      const result = target.substring(ORIGIN_REMOTE_PREFIX.length);
      defaultBranchCache.set(normalizedPath, result);
      return result;
    }

    defaultBranchCache.set(normalizedPath, undefined);
    return undefined;
  } catch {
    defaultBranchCache.set(normalizedPath, undefined);
    return undefined;
  }
}

/**
 * Returns main branch candidates for merge-base selection.
 * When a default branch is known, returns only that branch; otherwise static names present locally.
 */
export async function getMainBranchCandidates(repoPath: string): Promise<string[]> {
  const normalizedPath = path.normalize(repoPath);
  const cached = mainBranchCandidatesCache.get(normalizedPath);
  if (cached) {
    return cached;
  }

  const defaultBranch = await getDefaultBranch(normalizedPath);
  if (defaultBranch) {
    const singleCandidate = [defaultBranch];
    mainBranchCandidatesCache.set(normalizedPath, singleCandidate);
    return singleCandidate;
  }

  try {
    const { stdout, stderr, exitCode } = await gitExecutor.execute(
      { command: 'git', args: ['branch', '--list', '--format=%(refname:short)'], taskId: GIT_TASK_ID },
      { cwd: normalizedPath }
    );

    if (exitCode !== 0) {
      if (exitCode === "ENOENT") {
        markGitAsUnavailable();
      }
      logOutputChannel.error(`Could not get local branches for ${normalizedPath} (exit code ${exitCode}): ${stderr}`);
      return [];
    }

    const localBranches = stdout.split('\n').map(branch => branch.trim()).filter(Boolean);
    const result = POSSIBLE_MAIN_BRANCHES.filter(branch => localBranches.includes(branch));
    mainBranchCandidatesCache.set(normalizedPath, result);
    return result;
  } catch (err) {
    if (isEnoentError(err)) {
      markGitAsUnavailable();
    }
    logOutputChannel.error(`Could not get local branches for ${normalizedPath}: ${err}`);
    return [];
  }
}

/**
 * Determines if the given branch is the repository default / main branch.
 */
export async function isMainBranch(currentBranch: string | undefined, repoPath: string): Promise<boolean> {
  if (!currentBranch) return false;

  const normalizedPath = path.normalize(repoPath);
  const defaultBranch = await getDefaultBranch(normalizedPath);
  if (defaultBranch) {
    return branchesEqual(currentBranch, defaultBranch);
  }

  const localMainBranches = await getMainBranchCandidates(normalizedPath);
  return localMainBranches.some((branch) => branchesEqual(branch, currentBranch));
}

export function deactivate() {
  gitFileDeleteEvent.dispose();
}
