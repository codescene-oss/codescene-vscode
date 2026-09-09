import * as path from 'path';
import vscode from 'vscode';
import type { Repository } from '../../types/git';
import type { CsIdeServerClient, DeltaResult, ServerStartEvent, WatchInventory } from '../devtools-api/ide-server-client';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import { ReviewPipeline, ReviewSubmission } from '../review/review-pipeline';
import { getRepoRootPath, isMainBranch } from '../git-utils';
import { pruneMonitorToPaths } from '../code-health-monitor/monitor-prune';
import { isPathUnderRoot, normalizeFsPath, relativePosix, toPosixRelPath } from '../utils/fs-paths';

export type WatchClient = Pick<
  CsIdeServerClient,
  | 'watchFiles'
  | 'stopWatchFiles'
  | 'getWatchInventory'
  | 'onDidWatchInventory'
  | 'onDidServerStart'
  | 'onDidDelta'
>;

/**
 * Long enough to collapse the burst of deltas the CLI emits after a rescan into one request.
 */
export const INVENTORY_REFRESH_DELAY_MS = 250;

export interface WorkspaceWatchDependencies {
  repositories(): readonly Repository[];
  textDocuments(): readonly vscode.TextDocument[];
  isExcluded(uri: vscode.Uri): boolean;
  shouldSkipRepo(repo: Repository): Promise<boolean>;
  pruneMonitor(repoRoots: string[], keepPaths: Set<string>): void;
}

interface WatchedRepo {
  headName?: string;
  headCommit?: string;
}

interface RepoInventory {
  repoRoot: string;
  relPaths: Set<string>;
}

export class WorkspaceWatch implements vscode.Disposable {
  private readonly watched = new Map<string, WatchedRepo>();
  private readonly inventories = new Map<string, RepoInventory>();
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  constructor(
    private readonly client: WatchClient,
    private readonly pipeline: ReviewPipeline,
    private readonly dependencies: WorkspaceWatchDependencies
  ) {
    this.disposables.push(
      client.onDidWatchInventory((inventory) => this.applyInventory(inventory)),
      client.onDidServerStart((event) => this.handleServerStart(event)),
      client.onDidDelta((event) => this.handleDelta(event))
    );
  }

  start(): void {
    for (const repo of this.dependencies.repositories()) {
      this.bindRepository(repo);
    }
    void this.syncAll();
  }

  bindRepository(repo: Repository): void {
    this.disposables.push(repo.state.onDidChange(() => void this.onRepositoryStateChange(repo)));
  }

  async syncAll(): Promise<void> {
    if (this.disposed) return;
    for (const repo of this.dependencies.repositories()) {
      try {
        await this.syncRepository(repo);
      } catch (error) {
        logOutputChannel.warn(`Workspace watch sync failed for ${getRepoRootPath(repo)}: ${error}`);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const repoRoot of this.watched.keys()) {
      this.client.stopWatchFiles(repoRoot);
    }
    this.watched.clear();
    this.inventories.clear();
    this.refreshTimers.forEach((timer) => clearTimeout(timer));
    this.refreshTimers.clear();
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private async onRepositoryStateChange(repo: Repository): Promise<void> {
    const watched = this.watched.get(normalizeFsPath(getRepoRootPath(repo)));
    if (watched && this.headUnchanged(watched, repo)) return;
    await this.syncRepository(repo);
  }

  private async syncRepository(repo: Repository): Promise<void> {
    if (this.disposed) return;
    const repoRoot = getRepoRootPath(repo);
    if (await this.dependencies.shouldSkipRepo(repo)) {
      this.stopWatching(repoRoot);
      return;
    }
    if (this.ensureWatch(repo, repoRoot)) return;
    await this.refreshInventory(repoRoot);
  }

  /**
   * The CLI owns the baseline and reacts to HEAD, refs and .codescene/config.json changes itself,
   * so an established watch is never restarted. A moved HEAD only re-seeds dirty buffers, which the
   * CLI cannot see. Returns whether the CLI was asked to (re)scan, which makes it push a fresh
   * inventory on its own.
   */
  private ensureWatch(repo: Repository, repoRoot: string): boolean {
    const normalizedRoot = normalizeFsPath(repoRoot);
    const previous = this.watched.get(normalizedRoot);
    if (previous && this.headUnchanged(previous, repo)) return false;
    if (previous) {
      this.rememberHead(normalizedRoot, repo);
    } else {
      this.startWatch(repo, repoRoot);
    }
    this.seed(repoRoot);
    return true;
  }

  private startWatch(repo: Repository, repoRoot: string): void {
    this.client.watchFiles(repoRoot);
    this.rememberHead(normalizeFsPath(repoRoot), repo);
  }

  private rememberHead(normalizedRoot: string, repo: Repository): void {
    this.watched.set(normalizedRoot, {
      headName: repo.state.HEAD?.name,
      headCommit: repo.state.HEAD?.commit,
    });
  }

  private headUnchanged(watched: WatchedRepo, repo: Repository): boolean {
    return watched.headName === repo.state.HEAD?.name && watched.headCommit === repo.state.HEAD?.commit;
  }

  stopWatching(repoRoot: string): void {
    const normalizedRoot = normalizeFsPath(repoRoot);
    if (!this.watched.has(normalizedRoot)) return;
    this.client.stopWatchFiles(repoRoot);
    this.watched.delete(normalizedRoot);
    this.applyInventory({ repoRoot, files: [] });
  }

  /**
   * The CLI reports the whole change set rather than individual removals, so a file that left it
   * is only recognisable by its absence here.
   */
  private applyInventory(inventory: WatchInventory): void {
    if (this.disposed) return;
    const repoRoot = this.resolveRepoRoot(inventory.repoRoot);
    this.inventories.set(normalizeFsPath(repoRoot), {
      repoRoot,
      relPaths: new Set(inventory.files.map(toPosixRelPath)),
    });
    const reported = Array.from(this.inventories.values());
    this.dependencies.pruneMonitor(
      reported.map((entry) => entry.repoRoot),
      this.pathsToKeep(reported)
    );
  }

  private async refreshInventory(repoRoot: string): Promise<void> {
    try {
      const inventory = await this.client.getWatchInventory(repoRoot);
      this.applyInventory({ repoRoot, files: inventory.files });
    } catch (error) {
      logOutputChannel.debug(`[watch] inventory refresh skipped for ${repoRoot}: ${error}`);
    }
  }

  /**
   * A delta for a file the change set does not list is either a result queued before the change
   * set shrank, or one that arrived ahead of the inventory that grew to include it. Asking the CLI
   * settles it without having to guess: the reply is ordered after everything already sent, and it
   * can only ever prune, so an early delta keeps its place in the monitor.
   */
  private handleDelta(event: DeltaResult): void {
    if (this.disposed || !event.result) return;
    const repoRoot = this.resolveRepoRoot(event.repoRoot);
    const inventory = this.inventories.get(normalizeFsPath(repoRoot));
    if (!inventory) return;
    const relPath = toPosixRelPath(event.path);
    if (inventory.relPaths.has(relPath)) return;
    if (this.dirtyDocuments(repoRoot).has(relPath)) return;
    this.scheduleInventoryRefresh(repoRoot);
  }

  private scheduleInventoryRefresh(repoRoot: string): void {
    const key = normalizeFsPath(repoRoot);
    const pending = this.refreshTimers.get(key);
    if (pending) clearTimeout(pending);
    this.refreshTimers.set(
      key,
      setTimeout(() => {
        this.refreshTimers.delete(key);
        void this.refreshInventory(repoRoot);
      }, INVENTORY_REFRESH_DELAY_MS)
    );
  }

  /**
   * Dirty buffers are monitored even when the file is unchanged on disk, so they survive a prune.
   */
  private pathsToKeep(reported: RepoInventory[]): Set<string> {
    const keep = new Set<string>();
    for (const { repoRoot, relPaths } of reported) {
      for (const relPath of relPaths) {
        keep.add(path.join(repoRoot, ...relPath.split('/')));
      }
    }
    for (const document of this.dependencies.textDocuments()) {
      if (document.uri.scheme === 'file' && document.isDirty) keep.add(document.uri.fsPath);
    }
    return keep;
  }

  /**
   * The CLI canonicalises repo roots, which can differ from the form VS Code reports.
   */
  private resolveRepoRoot(reported: string): string {
    const normalized = normalizeFsPath(reported);
    const known = this.dependencies
      .repositories()
      .find((repo) => normalizeFsPath(getRepoRootPath(repo)) === normalized);
    return known ? getRepoRootPath(known) : path.normalize(reported);
  }

  /**
   * A restarted server has no watches, and the extension missed every inventory change during the
   * outage. Existing inventories are kept until fresh ones arrive so the monitor does not blank out.
   */
  private handleServerStart(event: ServerStartEvent): void {
    if (!event.restart || this.disposed) return;
    logOutputChannel.info('[watch] cs-ide restarted, re-establishing repository watches');
    this.watched.clear();
    void this.syncAll();
  }

  private seed(repoRoot: string): void {
    const dirtyDocuments = this.dirtyDocuments(repoRoot);
    const submissions: ReviewSubmission[] = Array.from(dirtyDocuments, ([relPath, document]) =>
      this.bufferSubmission(relPath, document)
    );
    if (submissions.length === 0) return;
    logOutputChannel.info(`[watch] seeding reviewFiles count=${submissions.length} repo=${repoRoot}`);
    void this.pipeline.submitBatch(repoRoot, submissions).catch((error) => {
      logOutputChannel.warn(`Watch seed failed for ${repoRoot}: ${error}`);
    });
  }

  private dirtyDocuments(repoRoot: string): Map<string, vscode.TextDocument> {
    const documents = new Map<string, vscode.TextDocument>();
    const normalizedRoot = normalizeFsPath(repoRoot);
    for (const document of this.dependencies.textDocuments()) {
      if (document.uri.scheme !== 'file' || !document.isDirty) continue;
      if (!isPathUnderRoot(normalizedRoot, normalizeFsPath(document.uri.fsPath))) continue;
      const relPath = relativePosix(repoRoot, document.uri.fsPath);
      if (!this.isSupported(relPath)) continue;
      if (this.dependencies.isExcluded(document.uri)) continue;
      documents.set(relPath, document);
    }
    return documents;
  }

  private bufferSubmission(relPath: string, document: vscode.TextDocument): ReviewSubmission {
    return {
      document,
      relPath: toPosixRelPath(relPath),
      content: document.getText(),
      updateDiagnosticsPane: false,
      updateMonitor: true,
    };
  }

  private isSupported(filePath: string): boolean {
    return supportedExtensions.includes(path.extname(filePath));
  }
}

export function createWorkspaceWatchDependencies(
  repositories: () => readonly Repository[]
): WorkspaceWatchDependencies {
  return {
    repositories,
    textDocuments: () => vscode.workspace.textDocuments,
    isExcluded: (uri) => isExcludedByConfiguration(uri),
    shouldSkipRepo: async (repo) => isMainBranch(repo.state.HEAD?.name, getRepoRootPath(repo)),
    pruneMonitor: (repoRoots, keepPaths) => pruneMonitorToPaths(repoRoots, keepPaths),
  };
}

export function isExcludedByConfiguration(uri: vscode.Uri): boolean {
  const excludes = {
    ...vscode.workspace.getConfiguration('files', uri).get<Record<string, boolean>>('exclude', {}),
    ...vscode.workspace.getConfiguration('search', uri).get<Record<string, boolean>>('exclude', {}),
  };
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const relPath = workspaceFolder ? relativePosix(workspaceFolder.uri.fsPath, uri.fsPath) : toPosixRelPath(uri.fsPath);
  return Object.entries(excludes).some(([pattern, enabled]) => enabled && matchesExclude(pattern, relPath));
}

function matchesExclude(pattern: string, relPath: string): boolean {
  const normalized = toPosixRelPath(relPath);
  const escaped = pattern
    .split(/(\*\*|\*)/)
    .map((part) => {
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^(?:${escaped}|.*/${escaped})(?:/.*)?$`).test(normalized);
}
