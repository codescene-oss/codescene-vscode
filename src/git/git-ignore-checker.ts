import { normalize, sep } from 'path';
import vscode from 'vscode';
import { SimpleExecutor } from '../simple-executor';
import { getWorkspaceFolder } from '../utils';
import { IGNORED_DIRECTORIES } from '../review/ignored_dirs';
import { markGitAsUnavailable, isGitAvailable } from './git-detection';

interface PendingCheck {
  resolve: (ignored: boolean) => void;
  reject: (error: Error) => void;
}

export class GitIgnoreChecker {
  private gitExecutor: SimpleExecutor | null = null;
  private gitExecutorCache = new Map<string, boolean>();
  private watcher: vscode.FileSystemWatcher | null = null;
  private gitAvailabilityCheck: Promise<boolean>;
  private pendingChecks = new Map<string, PendingCheck[]>();
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private static readonly BATCH_DELAY_MS = 350;

  constructor() {
    const workspaceFolder = getWorkspaceFolder();
    if (workspaceFolder) {
      this.gitExecutor = new SimpleExecutor();
      this.watcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
      this.watcher.onDidChange(() => this.clearCache());
      this.watcher.onDidCreate(() => this.clearCache());
      this.watcher.onDidDelete(() => this.clearCache());

      this.gitAvailabilityCheck = this.checkGitAvailability();
    } else {
      this.gitAvailabilityCheck = Promise.resolve(false);
    }
  }

  private async checkGitAvailability(): Promise<boolean> {
    if (!this.gitExecutor) {
      return false;
    }

    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return false;
    }

    try {
      // Check if we're in a git repository:
      await this.gitExecutor.execute(
        { command: 'git', args: ['rev-parse', '--git-dir'], ignoreError: false },
        { cwd: workspaceFolder.uri.fsPath }
      );
      return true;
    } catch (error) {
      markGitAsUnavailable();
      return false;
    }
  }

  private clearCache() {
    this.gitExecutorCache = new Map<string, boolean>();
    for (const checks of this.pendingChecks.values()) {
      for (const check of checks) {
        check.reject(new Error('Cache cleared due to .gitignore change'));
      }
    }
    this.pendingChecks.clear();
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
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

  private isIgnoredByGit(filePath: string): Promise<boolean> {
    if (!this.gitExecutor) {
      return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      const existing = this.pendingChecks.get(filePath);
      if (existing) {
        existing.push({ resolve, reject });
      } else {
        this.pendingChecks.set(filePath, [{ resolve, reject }]);
      }

      if (!this.flushTimeout) {
        this.flushTimeout = setTimeout(() => this.flushPendingChecks(), GitIgnoreChecker.BATCH_DELAY_MS);
      }
    });
  }

  private resolveAllPending(checksSnapshot: Map<string, PendingCheck[]>, ignored: boolean): void {
    for (const checks of checksSnapshot.values()) {
      checks.forEach((check) => check.resolve(ignored));
    }
  }

  private rejectAllPending(checksSnapshot: Map<string, PendingCheck[]>, error: Error): void {
    for (const checks of checksSnapshot.values()) {
      checks.forEach((check) => check.reject(error));
    }
  }

  private async flushPendingChecks(): Promise<void> {
    this.flushTimeout = null;

    const checksSnapshot = new Map(this.pendingChecks);
    this.pendingChecks.clear();

    if (checksSnapshot.size === 0) {
      return;
    }

    const workspaceFolder = getWorkspaceFolder();
    if (!this.gitExecutor || !workspaceFolder) {
      this.resolveAllPending(checksSnapshot, false);
      return;
    }

    try {
      const pathsToCheck = Array.from(checksSnapshot.keys());
      const input = pathsToCheck.join('\0');
      const result = await this.gitExecutor.execute(
        { command: 'git', args: ['check-ignore', '--stdin', '-z'], ignoreError: true },
        { cwd: workspaceFolder.uri.fsPath },
        input
      );

      const ignoredPaths = new Set(
        result.stdout ? result.stdout.split('\0').filter((p) => p.length > 0).map((p) => normalize(p)) : []
      );

      for (const [filePath, checks] of checksSnapshot) {
        const ignored = ignoredPaths.has(filePath);
        this.gitExecutorCache.set(filePath, ignored);
        checks.forEach((check) => check.resolve(ignored));
      }
    } catch (error) {
      this.rejectAllPending(checksSnapshot, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async isIgnoredByGitWithRetry(filePath: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.isIgnoredByGit(filePath);
      } catch (error) {
        const isCacheClear = error instanceof Error && error.message === 'Cache cleared due to .gitignore change';
        if (!isCacheClear || attempt === 2) throw error;
      }
    }
    return false;
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

  async isIgnored(document: vscode.TextDocument): Promise<boolean> {
    if (!this.gitExecutor) return false;

    await this.gitAvailabilityCheck;

    const filePath = document.uri.fsPath;

    if (this.gitExecutorCache.has(filePath)) {
      return this.gitExecutorCache.get(filePath)!;
    }

    let ignored: boolean;

    if (isGitAvailable()) {
      ignored = await this.isIgnoredByGitWithRetry(filePath);
    } else {
      ignored = this.isIgnoredPerHeuristics(filePath);
    }

    this.gitExecutorCache.set(filePath, ignored);
    return ignored;
  }

  dispose() {
    this.watcher?.dispose();
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }
  }
}
