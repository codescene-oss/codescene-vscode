import * as assert from 'assert';
import * as vscode from '../mocks/vscode';
import { OpenFilesObserver } from '../../review/open-files-observer';
import { TestTextDocument } from '../mocks/test-text-document';
import { MockTextDocumentChangeEvent } from '../mocks/mock-text-document-change-event';
import { MockEditor } from '../mocks/mock-editor';
import { setMockVisibleTextEditors, setMockTabGroups, resetMockWindow, assertLogContains, assertLogOmits } from '../setup';
import { ReviewOpts } from '../../review/reviewer';

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

      (observer as any).visibleDocuments.add(filePath);

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
      (observer as any).visibleDocuments.add(filePath);

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
      (observer as any).visibleDocuments.add(document.fileName);
      (observer as any).trackAndReviewDocument(document, 'editor changed');
      assertLogContains('debug', 'reason=already-tracked');
    });

    test('logs empty-change skips for dirty visible files', () => {
      const document = new TestTextDocument('/test/monitor.ts', 'const value = 1;', 'typescript', 1).setDirty(true);
      setMockVisibleTextEditors([new MockEditor(document)]);
      (observer as any).visibleDocuments.add(document.fileName);
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
