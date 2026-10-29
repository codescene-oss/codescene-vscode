import * as assert from 'assert';
import vscode from 'vscode';
import { DeltaAnalysisEvent, DevtoolsAPI } from '../../devtools-api';
import { Delta } from '../../devtools-api/delta-model';
import { DeltaResult, ReviewFailed, ReviewQueue, ReviewResult } from '../../devtools-api/ide-server-client';
import { Review } from '../../devtools-api/review-model';
import Reviewer from '../../review/reviewer';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { TestTextDocument } from '../mocks/test-text-document';
import CsDiagnostics from '../../diagnostics/cs-diagnostics';
import { setMockGitRepositories, clearMockGitRepositories } from '../setup';

class FakeIdeServer {
  readonly reviewEmitter = new vscode.EventEmitter<ReviewResult>();
  readonly deltaEmitter = new vscode.EventEmitter<DeltaResult>();
  readonly failureEmitter = new vscode.EventEmitter<ReviewFailed>();
  readonly errorEmitter = new vscode.EventEmitter<Error>();
  readonly queueEmitter = new vscode.EventEmitter<ReviewQueue>();
  readonly batches: Array<{ repoRoot: string; files: Array<{ id?: string; relPath: string; content?: string }> }> = [];
  readonly onDidReview = this.reviewEmitter.event;
  readonly onDidDelta = this.deltaEmitter.event;
  readonly onDidReviewFailed = this.failureEmitter.event;
  readonly onDidError = this.errorEmitter.event;
  readonly onDidQueue = this.queueEmitter.event;

  reviewFiles(repoRoot: string, files: Array<{ id?: string; relPath: string; content?: string }>): void {
    this.batches.push({ repoRoot, files });
  }

  dispose(): void {
    this.reviewEmitter.dispose();
    this.deltaEmitter.dispose();
    this.failureEmitter.dispose();
    this.errorEmitter.dispose();
    this.queueEmitter.dispose();
  }
}

function emptyReview(): Review {
  return {
    'file-level-code-smells': [],
    'function-level-code-smells': [],
    'raw-score': 'raw',
  };
}

function degradation(): Delta {
  return {
    'old-score': 9,
    'new-score': 8,
    'score-change': -1,
    'file-level-findings': [],
    'function-level-findings': [],
  } as unknown as Delta;
}

suite('Delta presentation Test Suite', () => {
  const repoRoot = '/repo';
  let server: FakeIdeServer;
  let events: DeltaAnalysisEvent[];
  let listener: vscode.Disposable;

  setup(() => {
    const context = createMockExtensionContext(__dirname);
    server = new FakeIdeServer();
    DevtoolsAPI.init(process.execPath, context, server as any);
    Reviewer.init(context, () => new Map());
    CsDiagnostics.init(context);
    events = [];
    listener = DevtoolsAPI.onDidDeltaAnalysisComplete((event) => events.push(event));
    setMockGitRepositories([{ rootUri: { fsPath: '/repo' } }]);
  });

  teardown(() => {
    listener.dispose();
    DevtoolsAPI.dispose();
    clearMockGitRepositories();
  });

  const testCases = [
    {
      name: 'presents an enriched delta to the monitor when the review owns the monitor entry',
      updateMonitor: true,
    },
    {
      name: 'keeps an enriched delta out of the monitor when the review does not own the monitor entry',
      updateMonitor: false,
    },
  ];

  testCases.forEach(({ name, updateMonitor }) => {
    test(name, async () => {
      const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript');
      const review = DevtoolsAPI.reviewPipeline.submit(repoRoot, {
        document,
        relPath: 'src/file.ts',
        content: document.getText(),
        updateDiagnosticsPane: false,
        updateMonitor,
      });
      const id = server.batches[0].files[0].id;

      server.reviewEmitter.fire({ id, repoRoot, path: 'src/file.ts', result: emptyReview() });
      server.deltaEmitter.fire({ id, repoRoot, path: 'src/file.ts', result: degradation() });
      await review;

      await waitUntil(() => events.length === 2);
      assert.deepStrictEqual(
        events.map((event) => event.updateMonitor),
        [updateMonitor, updateMonitor]
      );
    });
  });

  test('restoreFromDiskIfBufferOwned asks the CLI for the saved file', () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript').setDirty(true);
    void DevtoolsAPI.reviewWithServer(document, { skipMonitorUpdate: false, updateDiagnosticsPane: false });

    DevtoolsAPI.restoreFromDiskIfBufferOwned(document);

    assert.strictEqual(server.batches.length, 2);
    assert.ok(server.batches[1].files.every((file) => file.content === undefined));
  });

  test('releaseBufferMonitorOwnership hands the monitor back without restoring from disk', async () => {
    const document = new TestTextDocument('/repo/src/file.ts', 'const value = 1;', 'typescript').setDirty(true);
    const review = DevtoolsAPI.reviewWithServer(document, { skipMonitorUpdate: false, updateDiagnosticsPane: false });
    const submitted = server.batches[0];
    const id = submitted.files[0].id;
    server.reviewEmitter.fire({ id, repoRoot: submitted.repoRoot, path: submitted.files[0].relPath, result: emptyReview() });
    server.deltaEmitter.fire({ id, repoRoot: submitted.repoRoot, path: submitted.files[0].relPath, result: null });
    await review;

    DevtoolsAPI.releaseBufferMonitorOwnership(document);
    DevtoolsAPI.restoreFromDiskIfBufferOwned(document);

    assert.strictEqual(server.batches.length, 1);
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for delta events');
}
