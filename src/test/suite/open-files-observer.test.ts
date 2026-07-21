import * as assert from 'assert';
import { OpenFilesObserver } from '../../review/open-files-observer';
import { TestTextDocument } from '../mocks/test-text-document';
import { MockTextDocumentChangeEvent } from '../mocks/mock-text-document-change-event';
import { ExtensionContext } from '../mocks/vscode';

suite('OpenFilesObserver Test Suite', () => {
  let observer: OpenFilesObserver;

  setup(() => {
    const mockContext = {
      subscriptions: [],
    } as unknown as ExtensionContext;
    observer = new OpenFilesObserver(mockContext as any);
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
      },
      {
        name: 'returns false on first call (no prior version stored)',
        filePath: '/test/file2.ts',
        version: 1,
        contentChanges: [{}],
        priorVersion: undefined,
        expected: false,
      },
      {
        name: 'returns true when document version unchanged',
        filePath: '/test/file3.ts',
        version: 5,
        contentChanges: [{}],
        priorVersion: 5,
        expected: true,
      },
      {
        name: 'returns false when document version changed',
        filePath: '/test/file4.ts',
        version: 6,
        contentChanges: [{}],
        priorVersion: 5,
        expected: false,
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
});
