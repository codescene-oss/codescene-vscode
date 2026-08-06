import { createHash } from 'crypto';
import vscode from 'vscode';
import { Delta } from '../devtools-api/delta-model';
import {
  CsIdeServerClient,
  DeltaResult,
  ReviewFailed,
  ReviewResult,
} from '../devtools-api/ide-server-client';
import { Review } from '../devtools-api/review-model';
import { logOutputChannel } from '../log';
import { normalizeFsPath, pathsEqual, relativePosix, toPosixRelPath } from '../utils/fs-paths';

export interface ReviewSubmission {
  document: vscode.TextDocument;
  relPath: string;
  content: string;
  updateDiagnosticsPane: boolean;
  updateMonitor: boolean;
}

export interface PresentedReview extends ReviewSubmission {
  baselineRevision: string;
  result: Review;
}

export interface PresentedDelta extends ReviewSubmission {
  baselineRevision: string;
  result: Delta | null;
}

export interface ReviewPipelinePresentation {
  reviewStarted(document: vscode.TextDocument): void;
  reviewFinished(document: vscode.TextDocument): void;
  deltaStarted(document: vscode.TextDocument): void;
  deltaFinished(document: vscode.TextDocument): void;
  presentReview(review: PresentedReview): void;
  presentDelta(delta: PresentedDelta): void;
  remove(document: vscode.TextDocument): void;
  failed(error: Error): void;
}

interface PendingReview extends ReviewSubmission {
  id: string;
  repoRoot: string;
  baselineRevision: string;
  dedupKey: string;
  pathKey: string;
  contentHash: string;
  generation: number;
  reviewDone: boolean;
  deltaDone: boolean;
  reviewResult?: Review;
  deltaResult?: Delta | null;
  submitted: boolean;
  resolve: (review: Review | void) => void;
  reject: (error: Error) => void;
  promise: Promise<Review | void>;
}

export class ReviewPipeline implements vscode.Disposable {
  private readonly pendingById = new Map<string, PendingReview>();
  private readonly latestByPath = new Map<string, PendingReview>();
  private readonly tombstones = new Map<string, number>();
  private readonly generations = new Map<string, number>();
  private dedupEpoch = 0;
  private readonly disposables: vscode.Disposable[];

  constructor(
    private readonly client: CsIdeServerClient,
    private readonly presentation: ReviewPipelinePresentation,
    private readonly createId: () => string
  ) {
    this.disposables = [
      client.onDidReview((event) => this.handleReview(event)),
      client.onDidDelta((event) => this.handleDelta(event)),
      client.onDidReviewFailed((event) => this.handleFailure(event)),
      client.onDidError((error) => this.failAll(error)),
    ];
  }

  submitBatch(
    repoRoot: string,
    baselineRevision: string,
    baselineEpoch: string,
    submissions: ReviewSubmission[]
  ): Promise<Array<Review | void>> {
    const newReviews: PendingReview[] = [];
    const promises = submissions.map((submission) => {
      const pending = this.prepareSubmission(repoRoot, baselineRevision, baselineEpoch, submission);
      if (!pending.submitted) {
        this.pendingById.set(pending.id, pending);
        pending.submitted = true;
        newReviews.push(pending);
      }
      return pending.promise;
    });

    if (newReviews.length > 0) {
      this.client.reviewFiles(
        repoRoot,
        newReviews.map(({ id, relPath, content }) => ({ id, relPath, content })),
        baselineRevision || undefined
      );
    }
    return Promise.all(promises);
  }

  submit(
    repoRoot: string,
    baselineRevision: string,
    baselineEpoch: string,
    submission: ReviewSubmission
  ): Promise<Review | void> {
    return this.submitBatch(repoRoot, baselineRevision, baselineEpoch, [submission]).then(([review]) => review);
  }

  remove(repoRoot: string, documents: vscode.TextDocument[]): void {
    for (const document of documents) {
      const pathKey = this.pathKey(repoRoot, relativePosix(repoRoot, document.uri.fsPath));
      const latest = this.latestByPath.get(pathKey);
      if (latest) this.ignorePending(latest);
      const generation = this.nextGeneration(pathKey);
      this.tombstones.set(pathKey, generation);
      this.latestByPath.delete(pathKey);
      this.presentation.remove(document);
    }
  }

  invalidate(): void {
    this.dedupEpoch++;
  }

  dispose(): void {
    this.failAll(new Error('Review pipeline stopped'));
    this.disposables.forEach((disposable) => disposable.dispose());
    this.latestByPath.clear();
    this.tombstones.clear();
  }

  private prepareSubmission(
    repoRoot: string,
    baselineRevision: string,
    baselineEpoch: string,
    submission: ReviewSubmission
  ): PendingReview {
    const normalizedSubmission = {
      ...submission,
      relPath: toPosixRelPath(submission.relPath),
    };
    const pathKey = this.pathKey(repoRoot, normalizedSubmission.relPath);
    const contentHash = gitBlobSha(normalizedSubmission.content);
    const dedupKey = `${pathKey}\0${contentHash}\0${baselineEpoch}\0${this.dedupEpoch}`;
    const latest = this.latestByPath.get(pathKey);
    if (latest?.dedupKey === dedupKey) {
      this.mergePresentation(latest, normalizedSubmission);
      return latest;
    }
    if (latest) this.ignorePending(latest);

    const generation = this.nextGeneration(pathKey);
    let resolve!: (review: Review | void) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Review | void>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    void promise.catch(() => undefined);
    const pending: PendingReview = {
      ...normalizedSubmission,
      id: this.createId(),
      repoRoot: normalizeFsPath(repoRoot),
      baselineRevision,
      dedupKey,
      pathKey,
      contentHash,
      generation,
      reviewDone: false,
      deltaDone: false,
      submitted: false,
      resolve,
      reject,
      promise,
    };
    this.tombstones.delete(pathKey);
    this.latestByPath.set(pathKey, pending);
    this.presentation.reviewStarted(normalizedSubmission.document);
    this.presentation.deltaStarted(normalizedSubmission.document);
    return pending;
  }

  private mergePresentation(pending: PendingReview, submission: ReviewSubmission): void {
    const updateDiagnostics = !pending.updateDiagnosticsPane && submission.updateDiagnosticsPane;
    const updateMonitor = !pending.updateMonitor && submission.updateMonitor;
    pending.updateDiagnosticsPane ||= submission.updateDiagnosticsPane;
    pending.updateMonitor ||= submission.updateMonitor;
    this.presentMergedReview(pending, updateDiagnostics);
    this.presentMergedDelta(pending, updateMonitor);
  }

  private presentMergedReview(pending: PendingReview, updateDiagnostics: boolean): void {
    if (updateDiagnostics && pending.reviewResult) {
      this.presentation.presentReview({ ...pending, result: pending.reviewResult });
    }
  }

  private presentMergedDelta(pending: PendingReview, updateMonitor: boolean): void {
    if (updateMonitor && pending.deltaDone) {
      this.presentation.presentDelta({ ...pending, result: pending.deltaResult ?? null });
    }
  }

  private handleReview(event: ReviewResult): void {
    const pending = this.pendingById.get(event.id);
    if (!pending || pending.reviewDone) return;
    pending.reviewDone = true;
    this.presentation.reviewFinished(pending.document);
    if (!this.isCurrent(pending, event.repoRoot, event.path) || !this.matchesHash(event.result['git-blob-sha'], pending.contentHash)) {
      logOutputChannel.warn(
        `[pipeline] ignoring fileReview id=${event.id} path=${event.path} repo=${event.repoRoot} ` +
          `(pending path=${pending.relPath} repo=${pending.repoRoot})`
      );
      this.ignorePending(pending);
      return;
    }
    pending.reviewResult = event.result;
    pending.resolve(event.result);
    this.presentation.presentReview({ ...pending, result: event.result });
    this.cleanup(pending);
  }

  private handleDelta(event: DeltaResult): void {
    const pending = this.pendingById.get(event.id);
    if (!pending || pending.deltaDone) return;
    pending.deltaDone = true;
    this.presentation.deltaFinished(pending.document);
    const hash = event.result?.['new-git-blob-sha'];
    if (this.isCurrent(pending, event.repoRoot, event.path) && this.matchesHash(hash, pending.contentHash)) {
      pending.deltaResult = event.result;
      this.presentation.presentDelta({ ...pending, result: event.result });
    } else {
      logOutputChannel.warn(
        `[pipeline] ignoring deltaReview id=${event.id} path=${event.path} repo=${event.repoRoot} ` +
          `(pending path=${pending.relPath} repo=${pending.repoRoot})`
      );
    }
    this.cleanup(pending);
  }

  private handleFailure(failure: ReviewFailed): void {
    const pending = this.pendingById.get(failure.id);
    if (!pending) return;
    if (!this.isCurrent(pending, failure.repoRoot, failure.path)) {
      this.ignorePending(pending);
      return;
    }
    const error = new Error(failure.message);
    this.completePending(pending, error);
    this.latestByPath.delete(pending.pathKey);
    this.presentation.failed(error);
  }

  private failAll(error: Error): void {
    const pendingReviews = Array.from(this.pendingById.values());
    pendingReviews.forEach((pending) => this.completePending(pending, error));
    this.latestByPath.clear();
    if (pendingReviews.length > 0) this.presentation.failed(error);
  }

  private completePending(pending: PendingReview, error?: Error): void {
    if (!pending.reviewDone) {
      pending.reviewDone = true;
      this.presentation.reviewFinished(pending.document);
    }
    if (!pending.deltaDone) {
      pending.deltaDone = true;
      this.presentation.deltaFinished(pending.document);
    }
    if (error) pending.reject(error);
    else pending.resolve();
    this.pendingById.delete(pending.id);
  }

  private ignorePending(pending: PendingReview): void {
    this.completePending(pending);
  }

  private cleanup(pending: PendingReview): void {
    if (pending.reviewDone && pending.deltaDone) this.pendingById.delete(pending.id);
  }

  private isCurrent(pending: PendingReview, repoRoot: string, relPath: string): boolean {
    return pathsEqual(pending.repoRoot, repoRoot)
      && toPosixRelPath(pending.relPath) === toPosixRelPath(relPath)
      && this.latestByPath.get(pending.pathKey) === pending
      && gitBlobSha(pending.document.getText()) === pending.contentHash
      && (this.tombstones.get(pending.pathKey) ?? 0) < pending.generation;
  }

  private matchesHash(received: string | undefined, expected: string): boolean {
    return received === undefined || received === expected;
  }

  private pathKey(repoRoot: string, relPath: string): string {
    return `${normalizeFsPath(repoRoot)}\0${toPosixRelPath(relPath)}`;
  }

  private nextGeneration(pathKey: string): number {
    const generation = (this.generations.get(pathKey) ?? 0) + 1;
    this.generations.set(pathKey, generation);
    return generation;
  }
}

export function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
