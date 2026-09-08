import * as path from 'path';
import vscode from 'vscode';
import type { Repository } from '../../types/git';
import type { CsIdeServerClient } from '../devtools-api/ide-server-client';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import { ReviewPipeline, ReviewSubmission } from '../review/review-pipeline';
import { getMergeBaseCommit, getRepoRootPath, isMainBranch } from '../git-utils';
import { normalizeFsPath, relativePosix, toPosixRelPath } from '../utils/fs-paths';

export interface WorkspaceWatchDependencies {
  repositories(): readonly Repository[];
  textDocuments(): readonly vscode.TextDocument[];
  isExcluded(uri: vscode.Uri): boolean;
  shouldSkipRepo(repo: Repository): Promise<boolean>;
  getBaselineRevision(repo: Repository): Promise<string>;
}

interface WatchedRepo {
  baselineRevision: string;
  headName?: string;
  headCommit?: string;
}

export class WorkspaceWatch implements vscode.Disposable {
  private readonly watched = new Map<string, WatchedRepo>();
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  constructor(
    private readonly client: Pick<CsIdeServerClient, 'watchFiles' | 'stopWatchFiles'>,
    private readonly pipeline: ReviewPipeline,
    private readonly dependencies: WorkspaceWatchDependencies
  ) {}

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
    await this.ensureWatch(repo, repoRoot);
  }

  private async ensureWatch(repo: Repository, repoRoot: string): Promise<void> {
    const baselineRevision = await this.dependencies.getBaselineRevision(repo);
    const previous = this.watched.get(normalizeFsPath(repoRoot));
    if (this.isCurrentWatch(previous, repo, baselineRevision)) return;
    this.startWatch(repo, repoRoot, baselineRevision);
    this.seed(repoRoot, baselineRevision);
  }

  private startWatch(repo: Repository, repoRoot: string, baselineRevision: string): void {
    this.client.watchFiles(repoRoot, baselineRevision || undefined);
    this.watched.set(normalizeFsPath(repoRoot), {
      baselineRevision,
      headName: repo.state.HEAD?.name,
      headCommit: repo.state.HEAD?.commit,
    });
  }

  private isCurrentWatch(previous: WatchedRepo | undefined, repo: Repository, baselineRevision: string): boolean {
    return !!previous && previous.baselineRevision === baselineRevision && this.headUnchanged(previous, repo);
  }

  private headUnchanged(watched: WatchedRepo, repo: Repository): boolean {
    return watched.headName === repo.state.HEAD?.name && watched.headCommit === repo.state.HEAD?.commit;
  }

  stopWatching(repoRoot: string): void {
    const normalizedRoot = normalizeFsPath(repoRoot);
    if (!this.watched.has(normalizedRoot)) return;
    this.client.stopWatchFiles(repoRoot);
    this.watched.delete(normalizedRoot);
  }

  private seed(repoRoot: string, baselineRevision: string): void {
    const dirtyDocuments = this.dirtyDocuments(repoRoot);
    const submissions: ReviewSubmission[] = Array.from(dirtyDocuments, ([relPath, document]) =>
      this.bufferSubmission(relPath, document)
    );
    if (submissions.length === 0) return;
    logOutputChannel.info(`[watch] seeding reviewFiles count=${submissions.length} repo=${repoRoot}`);
    void this.pipeline.submitBatch(repoRoot, baselineRevision, baselineRevision || 'unborn', submissions).catch((error) => {
      logOutputChannel.warn(`Watch seed failed for ${repoRoot}: ${error}`);
    });
  }

  private dirtyDocuments(repoRoot: string): Map<string, vscode.TextDocument> {
    const documents = new Map<string, vscode.TextDocument>();
    const normalizedRoot = normalizeFsPath(repoRoot);
    for (const document of this.dependencies.textDocuments()) {
      if (document.uri.scheme !== 'file' || !document.isDirty) continue;
      if (!isPathUnderRepo(normalizedRoot, normalizeFsPath(document.uri.fsPath))) continue;
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
    getBaselineRevision: async (repo) => (await getMergeBaseCommit(repo)) ?? '',
  };
}

function isPathUnderRepo(normalizedRoot: string, documentPath: string): boolean {
  if (documentPath === normalizedRoot) return true;
  return documentPath.startsWith(normalizedRoot + path.sep) || documentPath.startsWith(`${normalizedRoot}/`);
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
