import * as path from 'path';
import vscode from 'vscode';
import type { Change, Repository } from '../../types/git';
import type { CsIdeServerClient } from '../devtools-api/ide-server-client';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import { ReviewPipeline, ReviewSubmission } from '../review/review-pipeline';
import { getMergeBaseCommit, getRepoRootPath, gitExecutor, GIT_TASK_ID, isMainBranch } from '../git-utils';
import { normalizeFsPath, relativePosix, toPosixRelPath } from '../utils/fs-paths';

export interface WorkspaceWatchDependencies {
  repositories(): readonly Repository[];
  textDocuments(): readonly vscode.TextDocument[];
  isExcluded(uri: vscode.Uri): boolean;
  shouldSkipRepo(repo: Repository): Promise<boolean>;
  getBaselineRevision(repo: Repository): Promise<string>;
  getCommittedPaths(repoRoot: string, baselineRevision: string, headCommit: string): Promise<Set<string>>;
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
    if (previous) this.client.stopWatchFiles(repoRoot);
    this.startWatch(repo, repoRoot, baselineRevision);
    await this.seed(repo, repoRoot, baselineRevision, repo.state.HEAD?.commit ?? '');
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

  private async seed(
    repo: Repository,
    repoRoot: string,
    baselineRevision: string,
    headCommit: string
  ): Promise<void> {
    const dirtyDocuments = this.dirtyDocuments(repoRoot);
    const diskPaths = await this.diskSeedPaths(repo, repoRoot, baselineRevision, headCommit, dirtyDocuments);
    const submissions: ReviewSubmission[] = [
      ...Array.from(dirtyDocuments, ([relPath, document]) => this.bufferSubmission(relPath, document)),
      ...Array.from(diskPaths, (relPath) => this.diskSubmission(relPath)),
    ];
    if (submissions.length === 0) return;
    logOutputChannel.info(`[watch] seeding reviewFiles count=${submissions.length} repo=${repoRoot}`);
    void this.pipeline.submitBatch(repoRoot, baselineRevision, baselineRevision || 'unborn', submissions).catch((error) => {
      logOutputChannel.warn(`Watch seed failed for ${repoRoot}: ${error}`);
    });
  }

  private async diskSeedPaths(
    repo: Repository,
    repoRoot: string,
    baselineRevision: string,
    headCommit: string,
    dirtyDocuments: Map<string, vscode.TextDocument>
  ): Promise<Set<string>> {
    const scmPaths = scmCandidatePaths(repo);
    const committedPaths = await this.committedSinceBaseline(repoRoot, baselineRevision, headCommit);
    const paths = new Set<string>();
    for (const relPath of [...scmPaths, ...committedPaths]) {
      const posixPath = toPosixRelPath(relPath);
      if (dirtyDocuments.has(posixPath)) continue;
      if (!this.isSupported(posixPath)) continue;
      if (this.dependencies.isExcluded(vscode.Uri.file(path.join(repoRoot, ...posixPath.split('/'))))) continue;
      paths.add(posixPath);
    }
    return paths;
  }

  private async committedSinceBaseline(
    repoRoot: string,
    baselineRevision: string,
    headCommit: string
  ): Promise<Set<string>> {
    if (!baselineRevision || !headCommit) return new Set();
    const paths = await this.dependencies.getCommittedPaths(repoRoot, baselineRevision, headCommit);
    return new Set(Array.from(paths, toPosixRelPath));
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

  private diskSubmission(relPath: string): ReviewSubmission {
    return {
      relPath: toPosixRelPath(relPath),
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
    getCommittedPaths,
  };
}

function scmCandidatePaths(repo: Repository): Set<string> {
  const changes = [
    ...repo.state.workingTreeChanges,
    ...repo.state.indexChanges,
    ...repo.state.untrackedChanges,
    ...repo.state.mergeChanges,
  ];
  const repoRoot = getRepoRootPath(repo);
  return new Set(
    changes
      .filter((change) => !isDeletedChange(change))
      .map((change) => relativePosix(repoRoot, change.uri.fsPath))
      .filter(Boolean)
  );
}

const DELETED_STATUSES = new Set<number>([
  2,
  6,
  14,
  15,
  17,
]);

function isDeletedChange(change: Change): boolean {
  return DELETED_STATUSES.has(change.status);
}

async function getCommittedPaths(repoRoot: string, baselineRevision: string, headCommit: string): Promise<Set<string>> {
  void headCommit;
  const result = await gitExecutor.execute(
    {
      command: 'git',
      args: ['diff', '--name-only', '-z', '--diff-filter=ACMR', `${baselineRevision}...HEAD`],
      taskId: GIT_TASK_ID,
    },
    { cwd: repoRoot, env: { GIT_OPTIONAL_LOCKS: '0' } }
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `git diff failed (${result.exitCode})`);
  }
  return new Set(
    result.stdout
      .split('\0')
      .map((entry) => toPosixRelPath(entry.trim()))
      .filter(Boolean)
  );
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
