/* eslint-disable @typescript-eslint/naming-convention */
import path from 'path';
import vscode from 'vscode';
import { GitExtension, Repository } from '../types/git';
import { QueuedSingleTaskExecutor } from './queued-single-task-executor';
import { logOutputChannel } from './log';

export const GIT_TASK_ID = 'git';
export const gitExecutor = new QueuedSingleTaskExecutor();
const gitFileDeleteEvent = new vscode.EventEmitter<string>();
export const onFileDeletedFromGit = gitFileDeleteEvent.event;
export const fireFileDeletedFromGit = (filePath: string) => gitFileDeleteEvent.fire(filePath);

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

/**
 * VS Code only opens a repository whose root lies at or below a workspace folder, unless
 * git.openRepositoryInParentFolders is set to 'always'. Resolving the root directly keeps features
 * working for a folder opened inside a larger repository, which is the common monorepo case.
 */
export async function resolveGitRoot(directory: string): Promise<string | undefined> {
  try {
    const result = await gitExecutor.execute(
      { command: 'git', args: ['rev-parse', '--show-toplevel'], ignoreError: true, taskId: GIT_TASK_ID },
      { cwd: directory }
    );
    if (result.exitCode !== 0) return undefined;
    const root = result.stdout.trim();
    return root ? path.normalize(root) : undefined;
  } catch {
    return undefined;
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

export function deactivate() {
  gitFileDeleteEvent.dispose();
}
