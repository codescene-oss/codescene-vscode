import { normalize, sep } from 'path';
import vscode from 'vscode';
import { gitExecutor, GIT_TASK_ID } from '../git-utils';
import { getWorkspaceFolder } from '../utils';
import { isGitignoreFile } from '../utils/workspace-patterns';
import { IGNORED_DIRECTORIES } from '../review/ignored_dirs';
import { markGitAsUnavailable, isGitAvailable } from './git-detection';

const CHECK_IGNORE_FLUSH_DELAY_MS = 8;
const CHECK_IGNORE_MAX_BATCH_SIZE = 200;

let sharedInstance: GitIgnoreChecker | undefined;

export function getSharedGitIgnoreChecker(): GitIgnoreChecker {
  if (!sharedInstance) {
    sharedInstance = new GitIgnoreChecker();
  }
  return sharedInstance;
}

export function disposeSharedGitIgnoreChecker(): void {
  sharedInstance?.dispose();
  sharedInstance = undefined;
}

/** Clears ignore cache when .gitignore files change (via workspace events, not globs). */
export function registerGitIgnoreCacheInvalidation(context: vscode.ExtensionContext): void {
  const invalidate = () => getSharedGitIgnoreChecker().invalidateCache();

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isGitignoreFile(document.uri.fsPath)) {
        invalidate();
      }
    }),
    vscode.workspace.onDidCreateFiles((event) => {
      if (event.files.some((uri) => isGitignoreFile(uri.fsPath))) {
        invalidate();
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      if (event.files.some((uri) => isGitignoreFile(uri.fsPath))) {
        invalidate();
      }
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      if (event.files.some(({ oldUri, newUri }) => isGitignoreFile(oldUri.fsPath) || isGitignoreFile(newUri.fsPath))) {
        invalidate();
      }
    })
  );
}

type PendingCheck = {
  resolve: (ignored: boolean) => void;
};

/** Parses NUL-delimited paths from `git check-ignore -z` stdout. */
export function parseCheckIgnoreOutput(stdout: string): Set<string> {
  const ignored = new Set<string>();
  if (!stdout) {
    return ignored;
  }

  for (const entry of stdout.split('\0')) {
    if (entry) {
      ignored.add(normalize(entry));
    }
  }
  return ignored;
}

export class GitIgnoreChecker {
  private gitExecutorCache = new Map<string, boolean>();
  private gitAvailabilityCheck: Promise<boolean>;
  private gitRootPath: string | undefined;
  private pendingChecks = new Map<string, PendingCheck[]>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushPromise: Promise<void> | undefined;

  constructor() {
    const workspaceFolder = getWorkspaceFolder();
    if (workspaceFolder) {
      this.gitAvailabilityCheck = this.checkGitAvailability();
    } else {
      this.gitAvailabilityCheck = Promise.resolve(false);
    }
  }

  invalidateCache(): void {
    this.gitExecutorCache = new Map<string, boolean>();
    this.gitRootPath = undefined;
  }

  private async checkGitAvailability(): Promise<boolean> {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return false;
    }

    try {
      // Check if we're in a git repository:
      await gitExecutor.execute(
        { command: 'git', args: ['rev-parse', '--git-dir'], ignoreError: false, taskId: GIT_TASK_ID },
        { cwd: workspaceFolder.uri.fsPath }
      );
      return true;
    } catch {
      markGitAsUnavailable();
      return false;
    }
  }

  private isRootLevelHiddenDirectory(filePath: string): boolean {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return false;
    }

    const workspacePath = workspaceFolder.uri.fsPath.split(sep);
    const filePathParts = filePath.split(sep);

    if (filePathParts.length > workspacePath.length) {
      const rootLevelDir = filePathParts[workspacePath.length];
      return Boolean(rootLevelDir && (rootLevelDir.startsWith('.') || rootLevelDir.startsWith('_')));
    }

    return false;
  }

  private containsIgnoredDirectory(filePath: string): boolean {
    const pathParts = filePath.split(sep);
    return pathParts.some((part) => IGNORED_DIRECTORIES.includes(part));
  }

  private async resolveGitRootPath(): Promise<string | undefined> {
    if (this.gitRootPath) {
      return this.gitRootPath;
    }

    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return undefined;
    }

    try {
      const result = await gitExecutor.execute(
        { command: 'git', args: ['rev-parse', '--show-toplevel'], ignoreError: false, taskId: GIT_TASK_ID },
        { cwd: workspaceFolder.uri.fsPath }
      );
      this.gitRootPath = normalize(result.stdout.trim());
      return this.gitRootPath;
    } catch {
      return undefined;
    }
  }

  private async checkIgnoredPathsByGit(filePaths: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    if (filePaths.length === 0) {
      return results;
    }

    const gitRootPath = await this.resolveGitRootPath();
    if (!gitRootPath) {
      for (const filePath of filePaths) {
        results.set(filePath, this.isIgnoredPerHeuristics(filePath));
      }
      return results;
    }

    const normalizedPaths = filePaths.map((filePath) => normalize(filePath));
    const stdin = normalizedPaths.map((filePath) => `${filePath}\0`).join('');

    // Batch paths in one `git check-ignore -z --stdin` call instead of one subprocess per file.
    const result = await gitExecutor.execute(
      {
        command: 'git',
        args: ['check-ignore', '-z', '--stdin'],
        ignoreError: true,
        taskId: GIT_TASK_ID,
      },
      { cwd: gitRootPath },
      stdin
    );

    if (result.exitCode === 'ENOENT') {
      markGitAsUnavailable();
      for (const filePath of normalizedPaths) {
        results.set(filePath, this.isIgnoredPerHeuristics(filePath));
      }
      return results;
    }

    const ignoredPaths = parseCheckIgnoreOutput(result.stdout);
    for (const filePath of normalizedPaths) {
      results.set(filePath, ignoredPaths.has(filePath));
    }
    return results;
  }

  private isIgnoredPerHeuristics(filePath: string): boolean {
    // Check if any directory starting with . or _ is exactly at the project root level:
    if (this.isRootLevelHiddenDirectory(filePath)) {
      return true;
    }

    // Check if any directory at any depth contains ignored directories:
    if (this.containsIgnoredDirectory(filePath)) {
      return true;
    }

    return false;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushPendingChecks();
    }, CHECK_IGNORE_FLUSH_DELAY_MS);
  }

  private takePendingBatch(): string[] {
    const batch: string[] = [];
    for (const filePath of this.pendingChecks.keys()) {
      batch.push(filePath);
      if (batch.length >= CHECK_IGNORE_MAX_BATCH_SIZE) {
        break;
      }
    }
    return batch;
  }

  private async flushPendingChecks(): Promise<void> {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    this.flushPromise = this.doFlushPendingChecks().finally(() => {
      this.flushPromise = undefined;
    });
    return this.flushPromise;
  }

  private async doFlushPendingChecks(): Promise<void> {
    while (this.pendingChecks.size > 0) {
      const batch = this.takePendingBatch();
      const waitersByPath = new Map<string, PendingCheck[]>();

      for (const filePath of batch) {
        const waiters = this.pendingChecks.get(filePath);
        if (waiters) {
          waitersByPath.set(filePath, waiters);
          this.pendingChecks.delete(filePath);
        }
      }

      if (waitersByPath.size === 0) {
        return;
      }

      const uncachedPaths = batch.filter((filePath) => !this.gitExecutorCache.has(filePath));
      let ignoredByPath = new Map<string, boolean>();

      if (uncachedPaths.length > 0) {
        ignoredByPath = await this.checkIgnoredPathsByGit(uncachedPaths);
        for (const [filePath, ignored] of ignoredByPath) {
          this.gitExecutorCache.set(filePath, ignored);
        }
      }

      for (const filePath of batch) {
        const ignored = this.gitExecutorCache.get(filePath) ?? ignoredByPath.get(filePath) ?? false;
        const waiters = waitersByPath.get(filePath) ?? [];
        for (const waiter of waiters) {
          waiter.resolve(ignored);
        }
      }
    }

    if (this.pendingChecks.size > 0) {
      this.scheduleFlush();
    }
  }

  private queueGitCheck(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const normalizedPath = normalize(filePath);
      const waiters = this.pendingChecks.get(normalizedPath);
      if (waiters) {
        waiters.push({ resolve });
      } else {
        this.pendingChecks.set(normalizedPath, [{ resolve }]);
      }

      if (this.pendingChecks.size >= CHECK_IGNORE_MAX_BATCH_SIZE) {
        if (this.flushTimer) {
          clearTimeout(this.flushTimer);
          this.flushTimer = undefined;
        }
        void this.flushPendingChecks();
        return;
      }

      this.scheduleFlush();
    });
  }

  async isIgnored(document: vscode.TextDocument): Promise<boolean> {
    await this.gitAvailabilityCheck;

    const filePath = normalize(document.uri.fsPath);

    if (this.gitExecutorCache.has(filePath)) {
      return this.gitExecutorCache.get(filePath)!;
    }

    if (!isGitAvailable()) {
      const ignored = this.isIgnoredPerHeuristics(filePath);
      this.gitExecutorCache.set(filePath, ignored);
      return ignored;
    }

    return this.queueGitCheck(filePath);
  }

  dispose() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}
