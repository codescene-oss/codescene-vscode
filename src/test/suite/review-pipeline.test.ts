import * as assert from 'assert';
import vscode from 'vscode';
import { DeltaResult, ReviewFailed, ReviewResult } from '../../devtools-api/ide-server-client';
import { Review } from '../../devtools-api/review-model';
import {
  PresentedDelta,
  PresentedReview,
  ReviewPipeline,
  ReviewPipelineFileAccess,
  ReviewPipelinePresentation,
  ReviewSubmission,
  gitBlobSha,
} from '../../review/review-pipeline';
import { TestTextDocument } from '../mocks/test-text-document';

class FakeReviewClient {
  readonly reviewEmitter = new vscode.EventEmitter<ReviewResult>();
  readonly deltaEmitter = new vscode.EventEmitter<DeltaResult>();
  readonly failureEmitter = new vscode.EventEmitter<ReviewFailed>();
  readonly errorEmitter = new vscode.EventEmitter<Error>();
  readonly batches: Array<{ repoRoot: string; baseline?: string; files: Array<{ id?: string; relPath: string; content?: string }> }> = [];
  readonly onDidReview = this.reviewEmitter.event;
  readonly onDidDelta = this.deltaEmitter.event;
  readonly onDidReviewFailed = this.failureEmitter.event;
  readonly onDidError = this.errorEmitter.event;

  reviewFiles(repoRoot: string, files: Array<{ id?: string; relPath: string; content?: string }>, baseline?: string): void {
    this.batches.push({ repoRoot, baseline, files });
  }
}

interface PresentationEvents {
  reviews: PresentedReview[];
  deltas: PresentedDelta[];
  removed: vscode.TextDocument[];
  failures: Error[];
}

function createPresentation(events: PresentationEvents): ReviewPipelinePresentation {
  return {
    reviewStarted: () => undefined,
    reviewFinished: () => undefined,
    deltaStarted: () => undefined,
    deltaFinished: () => undefined,
    presentReview: (review) => events.reviews.push(review),
    presentDelta: (delta) => events.deltas.push(delta),
    remove: (document) => events.removed.push(document),
    failed: (error) => events.failures.push(error),
  };
}

function submission(document: vscode.TextDocument): ReviewSubmission {
  return {
    document,
    relPath: 'src/file.ts',
    content: document.getText(),
    updateDiagnosticsPane: true,
    updateMonitor: true,
  };
}

function emptyReview(): Review {
  return {
    'file-level-code-smells': [],
    'function-level-code-smells': [],
    'raw-score': 'raw',
  };
}

function completeReview(client: FakeReviewClient, id: string, repoRoot: string, responsePath = 'src/file.ts'): void {
  client.reviewEmitter.fire({ id, repoRoot, path: responsePath, result: emptyReview() });
  client.deltaEmitter.fire({ id, repoRoot, path: responsePath, result: null });
}

suite('ReviewPipeline Test Suite', () => {
  const repoRoot = '/repo';
  let client: FakeReviewClient;
  let events: PresentationEvents;
  let pipeline: ReviewPipeline;
  let nextId: number;

  setup(() => {
    client = new FakeReviewClient();
    events = { reviews: [], deltas: [], removed: [], failures: [] };
    nextId = 1;
    pipeline = new ReviewPipeline(client as any, createPresentation(events), () => `review-${nextId++}`);
  });

  teardown(() => pipeline.dispose());

  test('submits one batch and deduplicates repo, path, content, and baseline epoch', () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    void pipeline.submitBatch(repoRoot, 'base', 'epoch', [submission(document), submission(document)]);

    assert.strictEqual(client.batches.length, 1);
    assert.strictEqual(client.batches[0].baseline, 'base');
    assert.deepStrictEqual(client.batches[0].files.map(({ relPath }) => relPath), ['src/file.ts']);
  });

  test('does not resubmit completed reviews when repository state changes without content or baseline changes', async () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    const firstReview = pipeline.submit(repoRoot, 'base', 'epoch', submission(document));
    completeReview(client, 'review-1', repoRoot);
    await firstReview;

    await pipeline.submit(repoRoot, 'base', 'epoch', submission(document));

    assert.strictEqual(client.batches.length, 1);
  });

  test('resubmits completed reviews when the baseline changes', async () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    const firstReview = pipeline.submit(repoRoot, 'base-1', 'epoch-1', submission(document));
    completeReview(client, 'review-1', repoRoot);
    await firstReview;

    void pipeline.submit(repoRoot, 'base-2', 'epoch-2', submission(document));

    assert.strictEqual(client.batches.length, 2);
    assert.strictEqual(client.batches[1].baseline, 'base-2');
  });

  test('only presents the latest generation for a path', async () => {
    const oldDocument = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    const newDocument = new TestTextDocument('/repo/src/file.ts', 'const value = 2;', 'typescript');
    const oldPromise = pipeline.submit(repoRoot, 'base', 'epoch', submission(oldDocument));
    const newPromise = pipeline.submit(repoRoot, 'base', 'epoch', submission(newDocument));

    client.reviewEmitter.fire({ id: 'review-1', repoRoot, path: 'src/file.ts', result: emptyReview() });
    client.deltaEmitter.fire({ id: 'review-1', repoRoot, path: 'src/file.ts', result: null });
    client.reviewEmitter.fire({ id: 'review-2', repoRoot, path: 'src/file.ts', result: emptyReview() });
    client.deltaEmitter.fire({ id: 'review-2', repoRoot, path: 'src/file.ts', result: null });

    await Promise.all([oldPromise, newPromise]);
    assert.deepStrictEqual(events.reviews.map(({ document }) => document.getText()), ['const value = 2;']);
    assert.strictEqual(events.deltas.length, 1);
    assert.strictEqual(events.deltas[0].result, null);
  });

  test('tombstones removed paths and ignores late responses', async () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    const reviewPromise = pipeline.submit(repoRoot, 'base', 'epoch', submission(document));
    pipeline.remove(repoRoot, [document]);

    client.reviewEmitter.fire({ id: 'review-1', repoRoot, path: 'src/file.ts', result: emptyReview() });
    client.deltaEmitter.fire({ id: 'review-1', repoRoot, path: 'src/file.ts', result: null });

    await reviewPromise;
    assert.strictEqual(events.removed.length, 1);
    assert.strictEqual(events.reviews.length, 0);
    assert.strictEqual(events.deltas.length, 0);
  });

  test('ignores notifications from another repository', async () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    const reviewPromise = pipeline.submit(repoRoot, 'base', 'epoch', submission(document));

    client.reviewEmitter.fire({ id: 'review-1', repoRoot: '/other', path: 'src/file.ts', result: emptyReview() });
    client.deltaEmitter.fire({ id: 'review-1', repoRoot: '/other', path: 'src/file.ts', result: null });

    await reviewPromise;
    assert.strictEqual(events.reviews.length, 0);
    assert.strictEqual(events.deltas.length, 0);
  });

  test('keeps identical relative paths isolated by repository', async () => {
    const firstDocument = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    const secondDocument = new TestTextDocument('/other/src/file.ts', 'const value = 2;', 'typescript');
    const firstPromise = pipeline.submit('/repo', 'base-1', 'epoch-1', submission(firstDocument));
    const secondPromise = pipeline.submit('/other', 'base-2', 'epoch-2', submission(secondDocument));

    client.reviewEmitter.fire({ id: 'review-1', repoRoot: '/repo', path: 'src/file.ts', result: emptyReview() });
    client.deltaEmitter.fire({ id: 'review-1', repoRoot: '/repo', path: 'src/file.ts', result: null });
    client.reviewEmitter.fire({ id: 'review-2', repoRoot: '/other', path: 'src/file.ts', result: emptyReview() });
    client.deltaEmitter.fire({ id: 'review-2', repoRoot: '/other', path: 'src/file.ts', result: null });

    await Promise.all([firstPromise, secondPromise]);
    assert.deepStrictEqual(events.reviews.map(({ document }) => document.fileName), [firstDocument.fileName, secondDocument.fileName]);
  });

  test('finishes and reports review failures', async () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    const reviewPromise = pipeline.submit(repoRoot, 'base', 'epoch', submission(document));

    client.failureEmitter.fire({ id: 'review-1', repoRoot, path: 'src/file.ts', message: 'Review failed' });

    await assert.rejects(reviewPromise, /Review failed/);
    assert.deepStrictEqual(events.failures.map(({ message }) => message), ['Review failed']);
  });

  test('accepts notifications when path separators or drive letter case differ', async () => {
    const windowsRoot = 'c:\\Git\\codescene';
    const document = new TestTextDocument('c:\\Git\\codescene\\CSharp\\Example.cs', 'class Example {}', 'csharp');
    const reviewPromise = pipeline.submit(
      windowsRoot,
      'base',
      'epoch',
      {
        document,
        relPath: 'CSharp\\Example.cs',
        content: document.getText(),
        updateDiagnosticsPane: true,
        updateMonitor: true,
      }
    );

    completeReview(client, 'review-1', 'C:\\Git\\codescene', 'CSharp/Example.cs');

    assert.ok(await reviewPromise);
    assert.strictEqual(events.reviews.length, 1);
    assert.strictEqual(events.deltas.length, 1);
  });

  test('submits disk files without id or content', () => {
    void pipeline.submitBatch(repoRoot, 'base', 'epoch', [{
      relPath: 'src/file.ts',
      updateDiagnosticsPane: false,
      updateMonitor: true,
    }]);

    assert.strictEqual(client.batches.length, 1);
    assert.deepStrictEqual(client.batches[0].files, [{ relPath: 'src/file.ts' }]);
  });

  test('presents id-less watch results when the git-blob SHA matches', async () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    pipeline.dispose();
    pipeline = new ReviewPipeline(client as any, createPresentation(events), () => 'review-1', fileAccess(document, true));
    const sha = gitBlobSha(document.getText());

    client.reviewEmitter.fire({
      repoRoot,
      path: 'src/file.ts',
      result: { ...emptyReview(), 'git-blob-sha': sha },
    });
    client.deltaEmitter.fire({
      repoRoot,
      path: 'src/file.ts',
      result: { 'file-level-findings': [], 'function-level-findings': [], 'new-git-blob-sha': sha } as any,
    });

    await waitUntil(() => events.reviews.length === 1 && events.deltas.length === 1);
    assert.strictEqual(events.reviews[0].updateDiagnosticsPane, true);
    assert.strictEqual(events.reviews[0].updateMonitor, true);
    assert.strictEqual(events.deltas[0].result?.['new-git-blob-sha'], sha);
  });

  test('discards id-less watch results with a stale git-blob SHA', async () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
    pipeline.dispose();
    pipeline = new ReviewPipeline(client as any, createPresentation(events), () => 'review-1', fileAccess(document, false));

    client.reviewEmitter.fire({
      repoRoot,
      path: 'src/file.ts',
      result: { ...emptyReview(), 'git-blob-sha': 'stale-sha' },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(events.reviews.length, 0);
  });
});

function fileAccess(document: vscode.TextDocument, visible: boolean): ReviewPipelineFileAccess {
  return {
    findOpenDocument: () => document,
    openDocument: async () => document,
    readFileBytes: async () => Buffer.from(document.getText(), 'utf8'),
    isVisible: () => visible,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('timed out waiting for pipeline presentation');
}
