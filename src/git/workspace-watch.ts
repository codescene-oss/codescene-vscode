import * as path from 'path';
import vscode from 'vscode';
import type { Repository } from '../../types/git';
import type { CsIdeServerClient, DeltaResult, ServerStartEvent, WatchInventory } from '../devtools-api/ide-server-client';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import { ReviewPipeline, ReviewSubmission } from '../review/review-pipeline';
import { getRepoRootPath, resolveGitRoot } from '../git-utils';
import { pruneMonitorToPaths } from '../code-health-monitor/monitor-prune';
import { isPathUnderRoot, normalizeFsPath, relativePosix, toPosixRelPath } from '../utils/fs-paths';
import { WatchScope, watchScopeKey, watchScopePaths, watchScopes } from './watch-scope';

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
  workspaceFolders(): readonly vscode.WorkspaceFolder[];
  gitRootFor(directory: string): Promise<string | undefined>;
  textDocuments(): readonly vscode.TextDocument[];
  isExcluded(uri: vscode.Uri): boolean;
  pruneMonitor(repoRoots: string[], keepPaths: Set<string>): void;
}

interface WatchedRepo {
  headName?: string;
  headCommit?: string;
  scopeKey: string;
}

/**
 * A repository VS Code has not opened has no Repository object, so HEAD cannot be tracked for it.
 * The CLI reacts to HEAD itself; only the re-seeding of dirty buffers is lost.
 */
interface WatchTarget {
  repoRoot: string;
  repo?: Repository;
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
  private readonly rootCache = new Map<string, string | undefined>();
  private readonly knownRoots = new Map<string, string>();
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
    const targets = await this.watchTargets();
    const resolved = targets.filter((target) => !target.repo).length;
    logOutputChannel.debug(
      `[watch] syncing ${targets.length} repositories reached by the workspace, ${resolved} of them resolved without the git extension`
    );
    for (const target of targets) {
      try {
        await this.syncTarget(target);
      } catch (error) {
        logOutputChannel.warn(`Workspace watch sync failed for ${target.repoRoot}: ${error}`);
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
    const repoRoot = getRepoRootPath(repo);
    const watched = this.watched.get(normalizeFsPath(repoRoot));
    if (watched && this.headUnchanged(watched, repo)) return;
    await this.syncTarget({ repoRoot, repo });
  }

  private async syncTarget(target: WatchTarget): Promise<void> {
    if (this.disposed) return;
    const scope = await this.scopeFor(target.repoRoot);
    if (!scope) {
      logOutputChannel.debug(`[watch] not watching ${target.repoRoot}: no workspace folder reaches into it`);
      this.stopWatching(target.repoRoot);
      return;
    }
    if (this.ensureWatch(target, scope)) return;
    await this.refreshInventory(target.repoRoot);
  }

  /**
   * The git extension leaves a repository unopened when its root sits above every workspace folder,
   * which is exactly the monorepo case the watch is narrowed for, so the root is resolved directly
   * as well. Repositories the workspace does not reach into are left alone, so opening a file from
   * outside the workspace never pulls its whole repository into the watch.
   */
  private async watchTargets(): Promise<WatchTarget[]> {
    const folders = this.dependencies.workspaceFolders();
    this.forgetClosedFolders(folders);
    const targets = new Map<string, WatchTarget>();
    for (const repo of this.dependencies.repositories()) {
      const repoRoot = getRepoRootPath(repo);
      targets.set(normalizeFsPath(repoRoot), { repoRoot, repo });
    }
    for (const folder of folders) {
      const repoRoot = await this.gitRootFor(folder.uri.fsPath);
      if (!repoRoot) continue;
      const key = normalizeFsPath(repoRoot);
      if (!targets.has(key)) targets.set(key, { repoRoot });
    }
    this.knownRoots.clear();
    for (const [key, target] of targets) {
      this.knownRoots.set(key, target.repoRoot);
    }
    return Array.from(targets.values());
  }

  /**
   * Repository state changes are frequent, so the lookup is cached. A root can only appear above a
   * folder that VS Code already declined to open, never below it, so a repository created later is
   * picked up by the git extension rather than by an expired cache entry.
   */
  private async gitRootFor(directory: string): Promise<string | undefined> {
    const key = normalizeFsPath(directory);
    if (this.rootCache.has(key)) return this.rootCache.get(key);
    const repoRoot = await this.dependencies.gitRootFor(directory);
    this.rootCache.set(key, repoRoot);
    return repoRoot;
  }

  private forgetClosedFolders(folders: readonly vscode.WorkspaceFolder[]): void {
    const open = new Set(folders.map((folder) => normalizeFsPath(folder.uri.fsPath)));
    for (const key of this.rootCache.keys()) {
      if (!open.has(key)) this.rootCache.delete(key);
    }
  }

  private async scopeFor(repoRoot: string): Promise<WatchScope | undefined> {
    const targets = await this.watchTargets();
    const repoRoots = targets.map((target) => target.repoRoot);
    return watchScopes(repoRoots, this.dependencies.workspaceFolders()).get(normalizeFsPath(repoRoot));
  }

  /**
   * The CLI owns the baseline and reacts to HEAD, refs and .codescene/config.json changes itself,
   * so an established watch is never restarted. A moved HEAD only re-seeds dirty buffers, which the
   * CLI cannot see. A changed scope is the exception: watchFiles replaces the watched roots rather
   * than adding to them, so the full list has to be resent. Returns whether the CLI was asked to
   * (re)scan, which makes it push a fresh inventory on its own.
   */
  private ensureWatch(target: WatchTarget, scope: WatchScope): boolean {
    const normalizedRoot = normalizeFsPath(target.repoRoot);
    const scopeKey = watchScopeKey(scope);
    const previous = this.watched.get(normalizedRoot);
    const established = previous?.scopeKey === scopeKey ? previous : undefined;
    if (established && this.headUnchanged(established, target.repo)) return false;
    if (established) {
      this.rememberHead(normalizedRoot, target.repo, scopeKey);
    } else {
      this.startWatch(target, scope);
    }
    this.seed(target.repoRoot);
    return true;
  }

  private startWatch(target: WatchTarget, scope: WatchScope): void {
    this.client.watchFiles(target.repoRoot, watchScopePaths(scope));
    this.rememberHead(normalizeFsPath(target.repoRoot), target.repo, watchScopeKey(scope));
  }

  private rememberHead(normalizedRoot: string, repo: Repository | undefined, scopeKey: string): void {
    this.watched.set(normalizedRoot, {
      headName: repo?.state.HEAD?.name,
      headCommit: repo?.state.HEAD?.commit,
      scopeKey,
    });
  }

  private headUnchanged(watched: WatchedRepo, repo: Repository | undefined): boolean {
    return watched.headName === repo?.state.HEAD?.name && watched.headCommit === repo?.state.HEAD?.commit;
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
    return this.knownRoots.get(normalizeFsPath(reported)) ?? path.normalize(reported);
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
    workspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
    gitRootFor: (directory) => resolveGitRoot(directory),
    textDocuments: () => vscode.workspace.textDocuments,
    isExcluded: (uri) => isExcludedByConfiguration(uri),
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
