import * as assert from 'assert';
import * as vscode from '../mocks/vscode';
import { OpenFilesObserver } from '../../review/open-files-observer';
import { TestTextDocument } from '../mocks/test-text-document';
import { MockTextDocumentChangeEvent } from '../mocks/mock-text-document-change-event';
import { MockEditor } from '../mocks/mock-editor';
import { setMockVisibleTextEditors, setMockTabGroups, resetMockWindow, assertLogContains, assertLogOmits, fireDidSaveTextDocument, fireDidCloseTextDocument, fireDidChangeVisibleTextEditors, fireDidChangeTabs } from '../setup';
import { ReviewOpts } from '../../review/reviewer';
import { DevtoolsAPI } from '../../devtools-api';
import CsDiagnostics from '../../diagnostics/cs-diagnostics';

suite('OpenFilesObserver Test Suite', () => {
  let observer: OpenFilesObserver;

  setup(() => {
    resetMockWindow();

    const mockContext = {
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
    observer = new OpenFilesObserver(mockContext as any);
  });

  teardown(() => {
    resetMockWindow();
  });

  suite('shouldSkipDocumentChange', () => {
    const testCases = [
      {
        name: 'returns true when contentChanges is empty',
        filePath: '/test/file1.ts',
        version: 1,
        contentChanges: [],
        priorVersion: undefined,
        expected: true,
        description: 'Diagnostic-only updates have no content changes',
      },
      {
        name: 'returns false on first call (no prior version stored)',
        filePath: '/test/file2.ts',
        version: 1,
        contentChanges: [{}],
        priorVersion: undefined,
        expected: false,
        description: 'First edit should trigger review',
      },
      {
        name: 'returns true when document version unchanged',
        filePath: '/test/file3.ts',
        version: 5,
        contentChanges: [{}],
        priorVersion: 5,
        expected: true,
        description: 'Duplicate events with same version should be skipped',
      },
      {
        name: 'returns false when document version changed',
        filePath: '/test/file4.ts',
        version: 6,
        contentChanges: [{}],
        priorVersion: 5,
        expected: false,
        description: 'New version should trigger review',
      },
      {
        name: 'returns true when contentChanges empty even with new version',
        filePath: '/test/file5.ts',
        version: 7,
        contentChanges: [],
        priorVersion: 6,
        expected: true,
        description: 'Empty contentChanges check takes precedence',
      },
    ];

    testCases.forEach(({ name, filePath, version, contentChanges, priorVersion, expected }) => {
      test(name, () => {
        if (priorVersion !== undefined) {
          const priorDoc = new TestTextDocument(filePath, '', 'typescript', priorVersion);
          const priorEvent = new MockTextDocumentChangeEvent(priorDoc, [{}] as any);
          observer.shouldSkipDocumentChange(priorEvent);
        }

        const doc = new TestTextDocument(filePath, '', 'typescript', version);
        const event = new MockTextDocumentChangeEvent(doc, contentChanges as any);
        const result = observer.shouldSkipDocumentChange(event);

        assert.strictEqual(result, expected, name);
      });
    });
  });

  suite('getAllVisibleFileNames interaction', () => {
    test('getAllVisibleFileNames is called during document change processing', () => {
      const filePath = '/test/visible-file.ts';
      const originalGetAllVisibleFileNames = observer.getAllVisibleFileNames.bind(observer);
      let getAllVisibleFileNamesCalled = false;

      observer.getAllVisibleFileNames = () => {
        getAllVisibleFileNamesCalled = true;
        return originalGetAllVisibleFileNames();
      };

      (observer as any).visibleDocuments.set(filePath, new TestTextDocument(filePath, '', 'typescript', 1));

      const doc = new TestTextDocument(filePath, '', 'typescript', 1);
      const event = new MockTextDocumentChangeEvent(doc, [{}] as any);

      observer.shouldSkipDocumentChange(event);

      assert.strictEqual(getAllVisibleFileNamesCalled, false,
        'getAllVisibleFileNames should not be called by shouldSkipDocumentChange - it is called in onDidChangeTextDocument handler');
    });
  });

  suite('monitor updates', () => {
    const filePath = '/test/monitor.ts';
    let capturedOpts: ReviewOpts[];

    setup(() => {
      capturedOpts = [];
      (observer as any).filteringReviewer = {
        reviewDiagnostics: (document: any, reviewOpts: ReviewOpts) => {
          capturedOpts.push(reviewOpts);
          return Promise.resolve();
        },
        dispose: () => {},
      };
    });

    test('leaves the monitor to the CLI watch when a file becomes visible', () => {
      const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript');

      (observer as any).trackAndReviewDocument(document, 'startup');

      assert.deepStrictEqual(capturedOpts.map(({ skipMonitorUpdate }) => skipMonitorUpdate), [true]);
      assertLogContains('debug', '[OpenFilesObserver] reviewing path=');
      assertLogContains('debug', 'reason=startup skipMonitor=true');
    });

    test('updates the monitor when an unsaved edit is reviewed', async function () {
      this.timeout(5000);
      const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
      setMockVisibleTextEditors([new MockEditor(document)]);
      (observer as any).visibleDocuments.set(filePath, new TestTextDocument(filePath, '', 'typescript', 1));

      (observer as any).scheduleTextChangeReview(new MockTextDocumentChangeEvent(document, [{}] as any));

      await waitForReview(() => capturedOpts.length === 1);
      assert.strictEqual(capturedOpts[0].skipMonitorUpdate, false);
      assertLogContains('debug', 'reason=text changed skipMonitor=false');
    });
  });

  suite('skip logging', () => {
    test('logs unsupported language skips', () => {
      const document = new TestTextDocument('/test/readme.md', '# hi', 'markdown');
      (observer as any).reviewDocument(document, 'startup');
      assertLogContains('debug', 'reason=unsupported-language');
    });

    test('logs already-tracked skips', () => {
      const document = new TestTextDocument('/test/monitor.ts', 'const value = 1;', 'typescript');
      (observer as any).visibleDocuments.set(document.fileName, document);
      (observer as any).trackAndReviewDocument(document, 'editor changed');
      assertLogContains('debug', 'reason=already-tracked');
    });

    test('logs empty-change skips for dirty visible files', () => {
      const document = new TestTextDocument('/test/monitor.ts', 'const value = 1;', 'typescript', 1).setDirty(true);
      setMockVisibleTextEditors([new MockEditor(document)]);
      (observer as any).visibleDocuments.set(document.fileName, document);
      (observer as any).scheduleTextChangeReview(new MockTextDocumentChangeEvent(document, [] as any));
      assertLogContains('debug', 'reason=empty-change');
    });

    test('does not log output-channel or untracked document changes', () => {
      const outputLog = {
        fileName: 'CodeScene.codescene-vscode.CodeScene Log.log',
        uri: { scheme: 'output', fsPath: 'CodeScene.codescene-vscode.CodeScene Log.log' },
        isDirty: false,
      } as any;
      (observer as any).scheduleTextChangeReview(new MockTextDocumentChangeEvent(outputLog, [{}] as any));
      (observer as any).scheduleTextChangeReview(
        new MockTextDocumentChangeEvent(new TestTextDocument('/test/other.ts', 'const value = 1;', 'typescript').setDirty(true), [{}] as any)
      );
      assertLogOmits('CodeScene Log.log');
      assertLogOmits('reason=not-tracked');
    });
  });

  suite('dirty buffer close', () => {
    const filePath = '/test/dirty.ts';
    let restoreCalls: any[];
    let releaseCalls: any[];
    let cancelledFiles: string[];
    let originalRestore: typeof DevtoolsAPI.restoreFromDiskIfBufferOwned;
    let originalRelease: typeof DevtoolsAPI.releaseBufferMonitorOwnership;
    let originalCancel: typeof CsDiagnostics.cancel;
    let originalSet: typeof CsDiagnostics.set;

    setup(() => {
      restoreCalls = [];
      releaseCalls = [];
      cancelledFiles = [];
      originalRestore = DevtoolsAPI.restoreFromDiskIfBufferOwned;
      originalRelease = DevtoolsAPI.releaseBufferMonitorOwnership;
      originalCancel = CsDiagnostics.cancel;
      originalSet = CsDiagnostics.set;
      DevtoolsAPI.restoreFromDiskIfBufferOwned = (document) => {
        restoreCalls.push(document);
      };
      DevtoolsAPI.releaseBufferMonitorOwnership = (document) => {
        releaseCalls.push(document);
      };
      CsDiagnostics.cancel = (fileName) => {
        cancelledFiles.push(fileName);
        originalCancel(fileName);
      };
      CsDiagnostics.set = () => undefined;
    });

    teardown(() => {
      DevtoolsAPI.restoreFromDiskIfBufferOwned = originalRestore;
      DevtoolsAPI.releaseBufferMonitorOwnership = originalRelease;
      CsDiagnostics.cancel = originalCancel;
      CsDiagnostics.set = originalSet;
      observer.dispose();
    });

    function track(document: TestTextDocument): void {
      (observer as any).visibleDocuments.set(document.fileName, document);
    }

    test('closing the last tab restores disk state for a dirty buffer', () => {
      const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
      track(document);

      (observer as any).clearDiagnosticsAndUntrack(filePath);

      assert.deepStrictEqual(restoreCalls, [document]);
      assert.deepStrictEqual(cancelledFiles, [filePath]);
    });

    test('saving releases buffer ownership before a later close restore', () => {
      const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
      track(document);

      (observer as any).handleDocumentSaved(document);
      (observer as any).clearDiagnosticsAndUntrack(filePath);

      assert.deepStrictEqual(releaseCalls, [document]);
      assert.deepStrictEqual(restoreCalls, [document]);
    });

    test('cancels a pending dirty review timer on untrack', async function () {
      this.timeout(5000);
      const capturedOpts: ReviewOpts[] = [];
      (observer as any).filteringReviewer = {
        reviewDiagnostics: (document: unknown, reviewOpts: ReviewOpts) => {
          void document;
          capturedOpts.push(reviewOpts);
          return Promise.resolve();
        },
        dispose: () => {},
      };
      const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
      setMockVisibleTextEditors([new MockEditor(document)]);
      track(document);

      (observer as any).scheduleTextChangeReview(new MockTextDocumentChangeEvent(document, [{}] as any));
      (observer as any).clearDiagnosticsAndUntrack(filePath);
      await new Promise((resolve) => setTimeout(resolve, 1200));

      assert.deepStrictEqual(capturedOpts, []);
      assert.deepStrictEqual(cancelledFiles, [filePath]);
    });

    test('restores again if a review finishes after the document is untracked', async () => {
      let finishReview: () => void = () => undefined;
      (observer as any).filteringReviewer = {
        reviewDiagnostics: () => new Promise<void>((resolve) => {
          finishReview = resolve;
        }),
        dispose: () => {},
      };
      const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
      track(document);

      (observer as any).reviewDocument(document, 'text changed', false);
      (observer as any).clearDiagnosticsAndUntrack(filePath);
      assert.strictEqual(restoreCalls.length, 1);

      finishReview();
      await Promise.resolve();
      await Promise.resolve();

      assert.strictEqual(restoreCalls.length, 2);
      assert.deepStrictEqual(restoreCalls, [document, document]);
    });

    test('does not untrack a file that still has a tab', () => {
      const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
      track(document);
      (observer as any).hasInitialized = true;
      setMockTabGroups([{ tabs: [{ input: new vscode.TabInputText(vscode.Uri.file(filePath)) }] }]);

      (observer as any).untrackHiddenDocuments();

      assert.ok((observer as any).visibleDocuments.has(filePath));
      assert.deepStrictEqual(restoreCalls, []);
    });

    test('untracks a file after its last tab is gone', () => {
      const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
      track(document);
      (observer as any).hasInitialized = true;
      setMockTabGroups([]);

      (observer as any).untrackHiddenDocuments();

      assert.deepStrictEqual(restoreCalls, [document]);
      assert.ok(!(observer as any).visibleDocuments.has(filePath));
    });

    suite('event wiring', () => {
      setup(() => {
        observer.start();
      });

      test('save releases buffer ownership', () => {
        const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);

        fireDidSaveTextDocument(document);

        assert.deepStrictEqual(releaseCalls, [document]);
      });

      test('save ignores non-file documents', () => {
        fireDidSaveTextDocument({
          fileName: 'output.log',
          uri: { scheme: 'output', fsPath: 'output.log' },
        });

        assert.deepStrictEqual(releaseCalls, []);
      });

      test('close restores when the file has no remaining tab', () => {
        const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
        track(document);
        setMockTabGroups([]);

        fireDidCloseTextDocument(document);

        assert.deepStrictEqual(restoreCalls, [document]);
      });

      test('close keeps the entry when another tab remains', () => {
        const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
        track(document);
        setMockTabGroups([{ tabs: [{ input: new vscode.TabInputText(vscode.Uri.file(filePath)) }] }]);

        fireDidCloseTextDocument(document);

        assert.ok((observer as any).visibleDocuments.has(filePath));
        assert.deepStrictEqual(restoreCalls, []);
      });

      test('close of an untracked document is a no-op', () => {
        const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);

        fireDidCloseTextDocument(document);

        assert.deepStrictEqual(restoreCalls, []);
      });

      test('tab change after init untracks files that left the editor', () => {
        const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
        track(document);
        (observer as any).hasInitialized = true;
        setMockTabGroups([]);

        fireDidChangeTabs();

        assert.deepStrictEqual(restoreCalls, [document]);
      });

      test('visible editor change untracks hidden documents', () => {
        const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
        track(document);
        (observer as any).hasInitialized = true;
        setMockTabGroups([]);

        fireDidChangeVisibleTextEditors();

        assert.deepStrictEqual(restoreCalls, [document]);
      });

      test('tab change before init does not untrack existing entries', () => {
        const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
        track(document);
        (observer as any).hasInitialized = false;
        setMockTabGroups([]);

        fireDidChangeTabs();

        assert.ok((observer as any).visibleDocuments.has(filePath));
        assert.deepStrictEqual(restoreCalls, []);
      });

      test('visible editor change before init does not untrack existing entries', () => {
        const document = new TestTextDocument(filePath, 'const value = 1;', 'typescript').setDirty(true);
        track(document);
        (observer as any).hasInitialized = false;
        setMockTabGroups([]);

        fireDidChangeVisibleTextEditors();

        assert.ok((observer as any).visibleDocuments.has(filePath));
        assert.deepStrictEqual(restoreCalls, []);
      });
    });
  });

  suite('scheme filtering', () => {
    const testCases = [
      {
        name: 'excludes non-file scheme from visibleTextEditors',
        editors: [
          { document: new TestTextDocument('/test/file.ts', '', 'typescript'), scheme: 'file' },
          { document: { fileName: 'output.log', uri: { scheme: 'output', fsPath: 'output.log' } }, scheme: 'output' },
        ],
        expectedCount: 1,
      },
      {
        name: 'excludes non-file scheme from tabGroups',
        tabGroups: [
          { tabs: [{ input: new vscode.TabInputText(vscode.Uri.file('/test/file1.ts')) }] },
          { tabs: [{ input: new vscode.TabInputText({ scheme: 'output', fsPath: 'log.log', path: 'log.log' } as any) }] },
        ],
        expectedCount: 1,
      },
      {
        name: 'includes only file scheme URIs',
        editors: [
          { document: new TestTextDocument('/test/file1.ts', '', 'typescript'), scheme: 'file' },
          { document: new TestTextDocument('/test/file2.ts', '', 'typescript'), scheme: 'file' },
        ],
        tabGroups: [
          { tabs: [{ input: new vscode.TabInputText(vscode.Uri.file('/test/file3.ts')) }] },
        ],
        expectedCount: 3,
      },
    ];

    testCases.forEach(({ name, editors, tabGroups, expectedCount }) => {
      test(name, () => {
        if (editors) {
          const mockEditors = editors.map(e => new MockEditor(e.document));
          setMockVisibleTextEditors(mockEditors);
        }
        if (tabGroups) {
          setMockTabGroups(tabGroups);
        }

        const result = observer.getAllVisibleFileNames();

        assert.strictEqual(result.size, expectedCount,
          `Expected ${expectedCount} files, got ${result.size}: ${Array.from(result).join(', ')}`);
      });
    });
  });
});

async function waitForReview(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for a review request');
}
