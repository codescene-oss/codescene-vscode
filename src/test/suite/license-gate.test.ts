import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { analysisLicenseHooks } from '../../auth/analysis-license-hooks';
import { INACTIVE_SNAPSHOT } from '../../auth/auth-payload';
import { isLicensed, LicenseGate } from '../../auth/license-gate';
import { ACE_ENABLED } from '../../build-flags';
import { CsExtensionState, type CsFeature } from '../../cs-extension-state';
import { DevtoolsAPI, type DeltaAnalysisEvent } from '../../devtools-api';
import { DeltaResult, ReviewFailed, ReviewQueue, ReviewResult } from '../../devtools-api/ide-server-client';
import { Review } from '../../devtools-api/review-model';
import CsDiagnostics from '../../diagnostics/cs-diagnostics';
import { CsReviewCodeLensProvider } from '../../review/codelens';
import { OpenFilesObserver } from '../../review/open-files-observer';
import Reviewer from '../../review/reviewer';
import { authStatusFixture, licensedSnapshot, snapshotWith, type AuthStatusFixture } from '../fixtures/auth/auth-fixtures';
import { MockDiagnosticCollection } from '../mocks/mock-diagnostic-collection';
import { MockEditor } from '../mocks/mock-editor';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { TestTextDocument } from '../mocks/test-text-document';
import {
  clearMockGitRepositories,
  getCapturedLogs,
  mockConfiguration,
  mockWorkspaceFolders,
  resetMockWindow,
  restoreDefaultConfiguration,
  restoreDefaultWorkspaceFolders,
  setMockGitRepositories,
  setMockVisibleTextEditors,
} from '../setup';

type Files = Array<{ id?: string; relPath: string; content?: string }>;

class FakeIdeServer {
  readonly reviewEmitter = new vscode.EventEmitter<ReviewResult>();
  readonly deltaEmitter = new vscode.EventEmitter<DeltaResult>();
  readonly failureEmitter = new vscode.EventEmitter<ReviewFailed>();
  readonly errorEmitter = new vscode.EventEmitter<Error>();
  readonly queueEmitter = new vscode.EventEmitter<ReviewQueue>();
  readonly batches: Array<{ repoRoot: string; files: Files }> = [];
  readonly onDidReview = this.reviewEmitter.event;
  readonly onDidDelta = this.deltaEmitter.event;
  readonly onDidReviewFailed = this.failureEmitter.event;
  readonly onDidError = this.errorEmitter.event;
  readonly onDidQueue = this.queueEmitter.event;

  reviewFiles(repoRoot: string, files: Files): void {
    this.batches.push({ repoRoot, files });
  }

  preflight(): Promise<unknown> {
    return Promise.resolve({});
  }

  get files(): Files {
    return this.batches.flatMap((batch) => batch.files);
  }

  dispose(): void {
    this.reviewEmitter.dispose();
    this.deltaEmitter.dispose();
    this.failureEmitter.dispose();
    this.errorEmitter.dispose();
    this.queueEmitter.dispose();
  }
}

interface FakeWatch {
  enabled: boolean[];
  resyncs: number;
  setEnabled(enabled: boolean): void;
  resync(): Promise<void>;
}

function fakeWatch(): FakeWatch {
  const watch: FakeWatch = {
    enabled: [],
    resyncs: 0,
    setEnabled: (value) => watch.enabled.push(value),
    resync: async () => {
      watch.resyncs++;
    },
  };
  return watch;
}

function emptyReview(): Review {
  return {
    'file-level-code-smells': [],
    'function-level-code-smells': [],
    'raw-score': 'raw',
  };
}

function statusSnapshot(name: AuthStatusFixture) {
  return snapshotWith(authStatusFixture(name));
}

async function waitUntil(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

suite('License gate Test Suite', () => {
  const cases: Array<{ name: string; snapshot: ReturnType<typeof snapshotWith>; licensed: boolean }> = [
    { name: 'signed in with a valid license', snapshot: statusSnapshot('signed-in-oauth'), licensed: true },
    { name: 'signed in with a valid license and a network error', snapshot: statusSnapshot('signed-in-network-error'), licensed: true },
    { name: 'signed in with a valid license on-prem', snapshot: statusSnapshot('signed-in-setting-token-onprem'), licensed: true },
    { name: 'signed in with a refused license', snapshot: statusSnapshot('signed-in-refused'), licensed: false },
    { name: 'signed in with an expired offline license', snapshot: statusSnapshot('signed-in-offline-expired'), licensed: false },
    { name: 'signed out', snapshot: statusSnapshot('signed-out'), licensed: false },
    { name: 'signing in', snapshot: statusSnapshot('signing-in'), licensed: false },
    { name: 'without a status', snapshot: snapshotWith(null), licensed: false },
    { name: 'inactive with a valid license', snapshot: { ...licensedSnapshot(), active: false }, licensed: false },
  ];

  cases.forEach(({ name, snapshot, licensed }) => {
    test(`isLicensed is ${licensed} when ${name}`, () => {
      assert.strictEqual(isLicensed(snapshot), licensed);
    });
  });

  test('fires each transition hook once per license change', () => {
    const calls: string[] = [];
    const gate = new LicenseGate({
      onLicensed: () => calls.push('licensed'),
      onUnlicensed: () => calls.push('unlicensed'),
      onServerRelicensed: () => calls.push('relicensed'),
    });

    assert.strictEqual(gate.licensed, false);
    gate.update(INACTIVE_SNAPSHOT);
    gate.update(statusSnapshot('signed-out'));
    gate.update(statusSnapshot('signed-in-oauth'));
    gate.update({ ...statusSnapshot('signed-in-oauth'), syncing: true });
    gate.update(statusSnapshot('signed-in-offline-expired'));
    gate.update(statusSnapshot('signed-in-refused'));
    gate.update(statusSnapshot('signed-in-oauth'));

    assert.deepStrictEqual(calls, ['licensed', 'unlicensed', 'licensed']);
    assert.strictEqual(gate.licensed, true);
  });

  const restartCases: Array<{ name: string; after: AuthStatusFixture[]; calls: string[] }> = [
    { name: 'a fresh licensed status', after: ['signed-in-oauth', 'signed-in-oauth'], calls: ['licensed', 'relicensed'] },
    {
      name: 'an unlicensed status first',
      after: ['signed-in-refused', 'signed-in-oauth'],
      calls: ['licensed', 'unlicensed', 'licensed'],
    },
  ];

  restartCases.forEach(({ name, after, calls: expected }) => {
    test(`after a cs-ide restart, waits for ${name} before relicensing`, () => {
      const calls: string[] = [];
      const gate = new LicenseGate({
        onLicensed: () => calls.push('licensed'),
        onUnlicensed: () => calls.push('unlicensed'),
        onServerRelicensed: () => calls.push('relicensed'),
      });
      const before = { ...licensedSnapshot(), serverStart: 1 };
      gate.update(before);

      gate.update({ ...before, syncing: true });
      gate.update({ ...before, repo: { path: '/repo', name: 'repo' } });
      after.forEach((status) => gate.update({ ...statusSnapshot(status), serverStart: 2 }));

      assert.deepStrictEqual(calls, expected);
    });
  });
});

suite('License gate analysis Test Suite', () => {
  const repoRoot = path.join(os.tmpdir(), 'cs-license-gate-test');
  let server: FakeIdeServer;
  let watch: FakeWatch;
  let gate: LicenseGate;
  let context: vscode.ExtensionContext;
  let collection: MockDiagnosticCollection;
  let originalCollection: vscode.DiagnosticCollection;
  let observer: OpenFilesObserver | undefined;

  function document(name: string, content = 'const value = 1;'): TestTextDocument {
    return new TestTextDocument(path.join(repoRoot, name), content, 'typescript');
  }

  setup(() => {
    fs.mkdirSync(repoRoot, { recursive: true });
    resetMockWindow();
    mockWorkspaceFolders(undefined);
    setMockGitRepositories([{ rootUri: { fsPath: repoRoot } }]);
    context = createMockExtensionContext(__dirname);
    server = new FakeIdeServer();
    DevtoolsAPI.init(process.execPath, context, server as any);
    Reviewer.init(context, () => new Map());
    CsDiagnostics.init(context);
    collection = new MockDiagnosticCollection();
    originalCollection = (CsDiagnostics as any).collection;
    (CsDiagnostics as any).collection = collection;
    watch = fakeWatch();
    observer = undefined;
    gate = new LicenseGate(analysisLicenseHooks({ watch: () => watch, observer: () => observer }));
    DevtoolsAPI.useLicenseGate(gate);
  });

  teardown(() => {
    observer?.dispose();
    (CsDiagnostics as any).collection = originalCollection;
    DevtoolsAPI.dispose();
    clearMockGitRepositories();
    restoreDefaultWorkspaceFolders();
    restoreDefaultConfiguration();
    resetMockWindow();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  test('licensed-transition-reseeds-open-documents', async function () {
    this.timeout(5000);
    const names = ['a.ts', 'b.ts', 'c.ts'];
    names.forEach((name) => fs.writeFileSync(path.join(repoRoot, name), `const ${name[0]} = 1;`));
    setMockVisibleTextEditors(names.map((name) => new MockEditor(document(name, `const ${name[0]} = 1;`))));
    observer = new OpenFilesObserver(context);
    observer.start();
    await settle();
    assert.deepStrictEqual(server.files, [], 'nothing is reviewed before the license is valid');

    gate.update(licensedSnapshot());

    await waitUntil(() => server.files.length === 3, 'three reviews');
    assert.deepStrictEqual(server.files.map(({ relPath }) => relPath).sort(), names);
    assert.ok(server.files.every(({ id, content }) => id !== undefined && content !== undefined));
    assert.deepStrictEqual(watch.enabled, [true]);
  });

  test('unlicensed-transition-clears-results', async () => {
    gate.update(licensedSnapshot());
    const doc = document('file.ts');
    const review = DevtoolsAPI.reviewWithServer(doc, { skipMonitorUpdate: false, updateDiagnosticsPane: true });
    const [{ files }] = server.batches;
    server.reviewEmitter.fire({ id: files[0].id, repoRoot, path: 'file.ts', result: emptyReview() });
    server.deltaEmitter.fire({ id: files[0].id, repoRoot, path: 'file.ts', result: null });
    await review;
    CsDiagnostics.set(doc.uri, [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'smell') as any]);
    assert.ok(Reviewer.instance.reviewCache.get(doc, 'any'), 'the review is cached while licensed');
    const codeLens = new CsReviewCodeLensProvider();
    let codeLensRefreshes = 0;
    const refresh = codeLens.onDidChangeCodeLenses(() => codeLensRefreshes++);

    gate.update(statusSnapshot('signed-in-offline-expired'));

    assert.strictEqual(collection.get(doc.uri), undefined);
    assert.strictEqual(collection.diagnosticsByUri.size, 0);
    assert.strictEqual(Reviewer.instance.reviewCache.get(doc, 'any'), undefined);
    assert.strictEqual(await codeLens.provideCodeLenses(doc, {} as vscode.CancellationToken), undefined);
    assert.ok(codeLensRefreshes > 0, 'CodeLens is asked to refresh');
    assert.deepStrictEqual(watch.enabled, [true, false]);
    refresh.dispose();
    codeLens.dispose();
  });

  test('a review answered after the license lapsed is not presented', async () => {
    gate.update(licensedSnapshot());
    const doc = document('late.ts');
    const reviews: unknown[] = [];
    const listener = DevtoolsAPI.onDidReviewComplete((event) => reviews.push(event));
    const review = DevtoolsAPI.reviewWithServer(doc, { skipMonitorUpdate: false, updateDiagnosticsPane: true });
    const [{ files }] = server.batches;

    gate.update(statusSnapshot('signed-in-refused'));
    server.reviewEmitter.fire({ id: files[0].id, repoRoot, path: 'late.ts', result: emptyReview() });
    server.reviewEmitter.fire({ repoRoot, path: 'late.ts', result: emptyReview() });
    await review;
    await settle();

    assert.deepStrictEqual(reviews, []);
    assert.strictEqual(Reviewer.instance.reviewCache.get(doc, 'any'), undefined);
    listener.dispose();
  });

  test('a restarted cs-ide that answers licensed resyncs the watch', () => {
    gate.update({ ...licensedSnapshot(), serverStart: 1 });
    gate.update({ ...licensedSnapshot(), serverStart: 2 });

    assert.deepStrictEqual({ enabled: watch.enabled, resyncs: watch.resyncs }, { enabled: [true], resyncs: 1 });
  });

  test('a delta enriched after the license lapsed is not presented', async () => {
    gate.update(licensedSnapshot());
    const doc = document('enriched.ts');
    const deltas: DeltaAnalysisEvent[] = [];
    const listener = DevtoolsAPI.onDidDeltaAnalysisComplete((event) => {
      deltas.push(event);
      if (!event.enrichment) gate.update(statusSnapshot('signed-in-refused'));
    });
    const review = DevtoolsAPI.reviewWithServer(doc, { skipMonitorUpdate: false, updateDiagnosticsPane: true });
    const [{ files }] = server.batches;
    server.reviewEmitter.fire({ id: files[0].id, repoRoot, path: 'enriched.ts', result: emptyReview() });
    server.deltaEmitter.fire({
      id: files[0].id,
      repoRoot,
      path: 'enriched.ts',
      result: { 'old-score': 9, 'new-score': 8, 'score-change': -1, 'file-level-findings': [], 'function-level-findings': [] },
    });
    await review;
    await settle();

    assert.deepStrictEqual(
      deltas.map(({ enrichment }) => enrichment === true),
      [false]
    );
    listener.dispose();
  });

  test('unlicensed-transition-disables-ace', async function () {
    if (!ACE_ENABLED) this.skip();
    await DevtoolsAPI.preflight();
    assert.strictEqual(DevtoolsAPI.aceEnabled(), true);
    gate.update(licensedSnapshot());
    const states: CsFeature['state'][] = [];
    const listener = DevtoolsAPI.onDidChangePreflightState((event) => states.push(event.state));

    gate.update(statusSnapshot('signed-in-offline-expired'));

    assert.deepStrictEqual({ aceEnabled: DevtoolsAPI.aceEnabled(), states }, { aceEnabled: false, states: ['disabled'] });
    listener.dispose();
  });

  test('licensed-respects-automatic-analysis-off', () => {
    mockConfiguration('codescene', { enableAutomaticAnalysis: false });

    gate.update(licensedSnapshot());

    assert.ok(!watch.enabled.includes(true), `watch enabled calls: ${JSON.stringify(watch.enabled)}`);
  });

  test('license-required-review-failure-is-not-an-error', async () => {
    gate.update(licensedSnapshot());
    CsExtensionState.init(context);
    CsExtensionState.addListeners(context);
    CsExtensionState.setAnalysisState({ state: 'enabled' });
    const failures: Error[] = [];
    const listener = DevtoolsAPI.onDidAnalysisFail((error) => failures.push(error));
    const doc = document('refused.ts');
    const review = DevtoolsAPI.reviewWithServer(doc, { skipMonitorUpdate: false, updateDiagnosticsPane: true });
    const [{ files }] = server.batches;

    server.failureEmitter.fire({
      id: files[0].id,
      repoRoot,
      path: 'refused.ts',
      message: 'Sign in to CodeScene to use Code Health analysis.',
      code: 'auth/license-required',
    });
    server.failureEmitter.fire({
      repoRoot,
      path: 'watched.ts',
      message: 'Sign in to CodeScene to use Code Health analysis.',
      code: 'auth/license-required',
    });

    assert.strictEqual(await review, undefined);
    assert.deepStrictEqual(failures, []);
    assert.notStrictEqual(CsExtensionState.stateProperties.features.analysis.state, 'error');
    const loud = getCapturedLogs().filter(({ level }) => level === 'warn' || level === 'error');
    assert.deepStrictEqual(loud, []);
    listener.dispose();
  });

  test('unlicensed-review-sends-nothing', async () => {
    for (const status of ['signed-out', 'signing-in', 'signed-in-refused', 'signed-in-offline-expired'] as const) {
      gate.update(statusSnapshot(status));
      assert.strictEqual(await DevtoolsAPI.reviewWithServer(document('file.ts')), undefined);
      assert.strictEqual(await DevtoolsAPI.reviewWithServer(document('file.ts')), undefined);
    }

    assert.deepStrictEqual(server.batches, []);
    assert.deepStrictEqual(watch.enabled, []);
  });
});
