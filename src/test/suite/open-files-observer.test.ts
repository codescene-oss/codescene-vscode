import * as assert from 'assert';
import * as vscode from '../mocks/vscode';
import { OpenFilesObserver } from '../../review/open-files-observer';
import { TestTextDocument } from '../mocks/test-text-document';
import { MockTextDocumentChangeEvent } from '../mocks/mock-text-document-change-event';
import { MockEditor } from '../mocks/mock-editor';
import { setMockVisibleTextEditors, setMockTabGroups, resetMockWindow } from '../setup';

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
