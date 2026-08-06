import { createHash } from 'crypto';
import * as path from 'path';
import vscode from 'vscode';
import type { Change, Repository } from '../../types/git';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import { ReviewPipeline, ReviewSubmission } from '../review/review-pipeline';
import { getMergeBaseCommit, getRepoRootPath, gitExecutor, GIT_TASK_ID, isMainBranch } from '../git-utils';
import { normalizeFsPath, relativePosix, toPosixRelPath } from '../utils/fs-paths';
import debounce = require('lodash.debounce');

const RECONCILE_DEBOUNCE_MS = 250;

export interface ReviewCandidateTrackerDependencies {
  repositories(): readonly Repository[];
  openDocument(filePath: string): Promise<vscode.TextDocument>;
  textDocuments(): readonly vscode.TextDocument[];
  ignoredPaths(repo: Repository, filePaths: string[]): Promise<Set<string>>;
  isExcluded(uri: vscode.Uri): boolean;
  shouldSkipRepo(repo: Repository): Promise<boolean>;
  getBaselineRevision(repo: Repository): Promise<string>;
  getCommittedPaths(repoRoot: string, baselineRevision: string, headCommit: string): Promise<Set<string>>;
  isWindowFocused(): boolean;
}

interface RepoCandidateState {
  baselineRevision: string;
  baselineEpoch: string;
  headCommit: string;
  candidates: Map<string, vscode.TextDocument>;
  fingerprint: string;
}

export class ReviewCandidateTracker implements vscode.Disposable {
  private readonly candidatesByRepo = new Map<string, RepoCandidateState>();
  private readonly committedPathsCache = new Map<string, { key: string; paths: Set<string> }>();
  private readonly disposables: vscode.Disposable[] = [];
  private running = false;
  private rerunRequested = false;
  private suppressDocumentEvents = false;
  private disposed = false;

  private readonly scheduleReconcile = debounce(() => {
    void this.reconcile();
  }, RECONCILE_DEBOUNCE_MS);

  constructor(
    private readonly pipeline: ReviewPipeline,
    private readonly dependencies: ReviewCandidateTrackerDependencies
  ) {}

  start(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(() => this.requestFromDocumentEvent()),
      vscode.workspace.onDidSaveTextDocument(() => this.requestFromDocumentEvent()),
      vscode.workspace.onDidCloseTextDocument(() => this.requestFromDocumentEvent()),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) this.request();
      })
    );
    for (const repo of this.dependencies.repositories()) {
      this.bindRepository(repo);
    }
    this.request();
  }

  bindRepository(repo: Repository): void {
    this.disposables.push(repo.state.onDidChange(() => this.request()));
  }

  request(): void {
    if (this.disposed) return;
    this.scheduleReconcile();
  }

  invalidateCommittedCache(repoRoot?: string): void {
    if (!repoRoot) {
      this.committedPathsCache.clear();
      return;
    }
    this.committedPathsCache.delete(normalizeFsPath(repoRoot));
  }

  async reconcileNow(): Promise<void> {
    this.scheduleReconcile.cancel();
    await this.reconcile();
  }

  dispose(): void {
    this.disposed = true;
    this.scheduleReconcile.cancel();
    this.disposables.forEach((disposable) => disposable.dispose());
    this.candidatesByRepo.clear();
    this.committedPathsCache.clear();
  }

  private requestFromDocumentEvent(): void {
    if (this.suppressDocumentEvents) return;
    this.request();
  }

  private async reconcile(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    if (!this.dependencies.isWindowFocused()) return;

    this.running = true;
    this.suppressDocumentEvents = true;
    try {
      for (const repo of this.dependencies.repositories()) {
        try {
          await this.reconcileRepository(repo);
        } catch (error) {
          logOutputChannel.warn(`Candidate reconciliation failed for ${getRepoRootPath(repo)}: ${error}`);
        }
      }
    } finally {
      this.suppressDocumentEvents = false;
      this.running = false;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.request();
      }
    }
  }

  private async reconcileRepository(repo: Repository): Promise<void> {
    if (await this.dependencies.shouldSkipRepo(repo)) {
      await this.clearRepository(repo);
      return;
    }

    const repoRoot = getRepoRootPath(repo);
    const baselineRevision = await this.dependencies.getBaselineRevision(repo);
    const headCommit = repo.state.HEAD?.commit ?? '';
    const baselineEpoch = baselineRevision || 'unborn';
    const current = await this.buildCandidates(repo, repoRoot, baselineRevision, headCommit);
    this.applyCandidateDiff(repoRoot, current);
    const fingerprint = candidateFingerprint(baselineEpoch, current);
    const previous = this.candidatesByRepo.get(normalizeFsPath(repoRoot));
    this.candidatesByRepo.set(normalizeFsPath(repoRoot), {
      baselineRevision,
      baselineEpoch,
      headCommit,
      candidates: current,
      fingerprint,
    });
    if (previous?.fingerprint === fingerprint) return;
    this.submitCandidates(repoRoot, baselineRevision, baselineEpoch, current);
  }

  private async buildCandidates(
    repo: Repository,
    repoRoot: string,
    baselineRevision: string,
    headCommit: string
  ): Promise<Map<string, vscode.TextDocument>> {
    const scmPaths = scmCandidatePaths(repo);
    const committedPaths = await this.committedSinceBaseline(repoRoot, baselineRevision, headCommit);
    const dirtyDocuments = this.dirtyDocuments(repoRoot);
    const candidatePaths = new Set([...scmPaths, ...committedPaths, ...dirtyDocuments.keys()]);
    const candidateDocuments = await this.loadCandidateDocuments(repoRoot, candidatePaths, dirtyDocuments);
    const pathsToCheck = Array.from(candidateDocuments.entries())
      .filter(([relPath]) => !scmPaths.has(relPath) && !committedPaths.has(relPath))
      .map(([, document]) => document.uri.fsPath);
    const ignoredPaths = await this.dependencies.ignoredPaths(repo, pathsToCheck);
    return this.filterCandidates(candidateDocuments, scmPaths, committedPaths, ignoredPaths);
  }

  private applyCandidateDiff(repoRoot: string, current: Map<string, vscode.TextDocument>): void {
    const previous = this.candidatesByRepo.get(normalizeFsPath(repoRoot))?.candidates ?? new Map<string, vscode.TextDocument>();
    const removed = Array.from(previous.entries())
      .filter(([relPath]) => !current.has(relPath))
      .map(([, document]) => document);
    if (removed.length > 0) this.pipeline.remove(repoRoot, removed);
  }

  private submitCandidates(
    repoRoot: string,
    baselineRevision: string,
    baselineEpoch: string,
    current: Map<string, vscode.TextDocument>
  ): void {
    const submissions = Array.from(current, ([relPath, document]) => this.submission(relPath, document));
    if (submissions.length === 0) return;
    logOutputChannel.info(`[candidates] submitting reviewFiles count=${submissions.length} repo=${repoRoot}`);
    void this.pipeline.submitBatch(repoRoot, baselineRevision, baselineEpoch, submissions).catch((error) => {
      logOutputChannel.warn(`Review batch failed for ${repoRoot}: ${error}`);
    });
  }

  private async clearRepository(repo: Repository): Promise<void> {
    const repoRoot = getRepoRootPath(repo);
    const previous = this.candidatesByRepo.get(normalizeFsPath(repoRoot));
    if (!previous) return;
    this.pipeline.remove(repoRoot, Array.from(previous.candidates.values()));
    this.candidatesByRepo.delete(normalizeFsPath(repoRoot));
  }

  private async committedSinceBaseline(repoRoot: string, baselineRevision: string, headCommit: string): Promise<Set<string>> {
    if (!baselineRevision || !headCommit) return new Set();
    const cacheKey = `${baselineRevision}\0${headCommit}`;
    const repoKey = normalizeFsPath(repoRoot);
    const cached = this.committedPathsCache.get(repoKey);
    if (cached?.key === cacheKey) return cached.paths;
    const paths = await this.dependencies.getCommittedPaths(repoRoot, baselineRevision, headCommit);
    const normalized = new Set(Array.from(paths, toPosixRelPath));
    this.committedPathsCache.set(repoKey, { key: cacheKey, paths: normalized });
    return normalized;
  }

  private dirtyDocuments(repoRoot: string): Map<string, vscode.TextDocument> {
    return this.documentsUnderRepo(repoRoot, (document) => document.isDirty);
  }

  private async loadCandidateDocuments(
    repoRoot: string,
    candidatePaths: Set<string>,
    dirtyDocuments: Map<string, vscode.TextDocument>
  ): Promise<Map<string, vscode.TextDocument>> {
    const openByPath = this.documentsUnderRepo(repoRoot);
    const candidates = new Map<string, vscode.TextDocument>();
    for (const relPath of candidatePaths) {
      const posixPath = toPosixRelPath(relPath);
      if (!this.isSupported(posixPath)) continue;
      const document =
        dirtyDocuments.get(posixPath)
        ?? openByPath.get(posixPath)
        ?? await this.openExistingDocument(repoRoot, posixPath);
      if (document) candidates.set(posixPath, document);
    }
    return candidates;
  }

  private documentsUnderRepo(
    repoRoot: string,
    predicate: (document: vscode.TextDocument) => boolean = () => true
  ): Map<string, vscode.TextDocument> {
    const documents = new Map<string, vscode.TextDocument>();
    const normalizedRoot = normalizeFsPath(repoRoot);
    for (const document of this.dependencies.textDocuments()) {
      if (document.uri.scheme !== 'file' || !predicate(document)) continue;
      if (!isPathUnderRepo(normalizedRoot, normalizeFsPath(document.uri.fsPath))) continue;
      documents.set(relativePosix(repoRoot, document.uri.fsPath), document);
    }
    return documents;
  }

  private async openExistingDocument(repoRoot: string, relPath: string): Promise<vscode.TextDocument | undefined> {
    try {
      return await this.dependencies.openDocument(path.join(repoRoot, ...relPath.split('/')));
    } catch {
      return undefined;
    }
  }

  private filterCandidates(
    candidates: Map<string, vscode.TextDocument>,
    scmPaths: Set<string>,
    committedPaths: Set<string>,
    ignoredPaths: Set<string>
  ): Map<string, vscode.TextDocument> {
    return new Map(
      Array.from(candidates).filter(([relPath, document]) => {
        if (this.dependencies.isExcluded(document.uri)) return false;
        if (scmPaths.has(relPath) || committedPaths.has(relPath)) return true;
        return !isIgnored(document, relPath, ignoredPaths);
      })
    );
  }

  private submission(relPath: string, document: vscode.TextDocument): ReviewSubmission {
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

export function createReviewCandidateTrackerDependencies(
  repositories: () => readonly Repository[],
  isWindowFocused: () => boolean
): ReviewCandidateTrackerDependencies {
  return {
    repositories,
    openDocument: async (filePath) => await vscode.workspace.openTextDocument(vscode.Uri.file(filePath)),
    textDocuments: () => vscode.workspace.textDocuments,
    ignoredPaths: (repo, filePaths) => (filePaths.length === 0 ? Promise.resolve(new Set()) : repo.checkIgnore(filePaths)),
    isExcluded: (uri) => isExcludedByConfiguration(uri),
    shouldSkipRepo: async (repo) => isMainBranch(repo.state.HEAD?.name, getRepoRootPath(repo)),
    getBaselineRevision: async (repo) => (await getMergeBaseCommit(repo)) ?? '',
    getCommittedPaths,
    isWindowFocused,
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
  2, // Status.INDEX_DELETED
  6, // Status.DELETED
  14, // Status.DELETED_BY_US
  15, // Status.DELETED_BY_THEM
  17, // Status.BOTH_DELETED
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

function candidateFingerprint(baselineEpoch: string, candidates: Map<string, vscode.TextDocument>): string {
  const parts = Array.from(candidates.entries())
    .map(([relPath, document]) => `${relPath}\0${createHash('sha1').update(document.getText()).digest('hex')}`)
    .sort();
  return createHash('sha1').update(`${baselineEpoch}\0${parts.join('\n')}`).digest('hex');
}

function isIgnored(document: vscode.TextDocument, relPath: string, ignoredPaths: Set<string>): boolean {
  const normalizedPaths = new Set(Array.from(ignoredPaths, (filePath) => normalizeFsPath(filePath)));
  return normalizedPaths.has(normalizeFsPath(document.uri.fsPath)) || normalizedPaths.has(normalizeFsPath(relPath));
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
