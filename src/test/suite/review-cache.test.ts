import * as assert from 'assert';
import * as vscode from 'vscode';
import { ReviewCache } from '../../review/review-cache';
import { CsReview } from '../../review/cs-review';
import { TestTextDocument } from '../mocks/test-text-document';
import { Review } from '../../devtools-api/review-model';

function createMockDocument(fileName: string, content: string = 'test content', version: number = 1): vscode.TextDocument {
  const doc = new TestTextDocument(fileName, content, 'typescript') as any;
  Object.defineProperty(doc, 'version', {
    value: version,
    writable: true,
    configurable: true
  });
  return doc as vscode.TextDocument;
}

function createMockReview(document: vscode.TextDocument): CsReview {
  const mockReview: Review = {
    score: 8.5,
    'raw-score': 'base64encodeddata',
    'file-level-code-smells': [],
    'function-level-code-smells': []
  };
  const mockPromise = Promise.resolve(mockReview);
  return new CsReview(document, mockPromise);
}

suite('ReviewCache Test Suite', () => {
  let reviewCache: ReviewCache;
  let codeHealthFileVersions: Map<string, number>;

  setup(() => {
    codeHealthFileVersions = new Map();

    const getCodeHealthFileVersions = () => {
      return codeHealthFileVersions;
    };

    reviewCache = new ReviewCache(getCodeHealthFileVersions);
  });

  function addReview(document: vscode.TextDocument): void {
    reviewCache.add(document, createMockReview(document), false);
  }

  function assertCacheHit(document: vscode.TextDocument, message: string): void {
    const retrieved = reviewCache.get(document, false);
    assert.ok(retrieved, message);
  }

  function assertCacheMiss(document: vscode.TextDocument, message: string): void {
    const retrieved = reviewCache.get(document, false);
    assert.strictEqual(retrieved, undefined, message);
  }

  function setRulesVersions(rules: Record<string, number>): void {
    Object.entries(rules).forEach(([path, version]) => {
      codeHealthFileVersions.set(path, version);
    });
  }

  test('should add and retrieve review from cache', async () => {
    const document = createMockDocument('/test/file.ts');
    addReview(document);

    const retrieved = reviewCache.get(document, false);
    assert.ok(retrieved, 'Should retrieve cached review');
    assert.strictEqual(retrieved!.document, document);
  });

  test('should return undefined for non-existent cache entry', () => {
    const document = createMockDocument('/test/nonexistent.ts');
    assertCacheMiss(document, 'Should return undefined for non-cached document');
  });

  test('should return exact version only when document version matches', async () => {
    const document = createMockDocument('/test/file.ts', 'content', 1);
    addReview(document);

    const exactMatch = reviewCache.getExactVersion(document, false);
    assert.ok(exactMatch, 'Should find exact version match');

    const documentV2 = createMockDocument('/test/file.ts', 'content', 2);
    const noMatch = reviewCache.getExactVersion(documentV2, false);
    assert.strictEqual(noMatch, undefined, 'Should not find match for different version');
  });

  test('should update existing cache entry', async () => {
    const document = createMockDocument('/test/file.ts');
    addReview(document);

    const updated = reviewCache.update(document, createMockReview(document), false);
    assert.strictEqual(updated, true, 'Should successfully update existing entry');
  });

  test('should not update non-existent cache entry', () => {
    const document = createMockDocument('/test/nonexistent.ts');
    const updated = reviewCache.update(document, createMockReview(document), false);
    assert.strictEqual(updated, false, 'Should return false when updating non-existent entry');
  });

  test('should delete cache entry by file path', async () => {
    const document = createMockDocument('/test/file.ts');
    addReview(document);
    reviewCache.delete(document.fileName);

    assertCacheMiss(document, 'Should not find deleted cache entry');
  });

  test('should clear all cache entries', async () => {
    const doc1 = createMockDocument('/test/file1.ts');
    const doc2 = createMockDocument('/test/file2.ts');

    addReview(doc1);
    addReview(doc2);
    reviewCache.clear();

    assertCacheMiss(doc1, 'Should not find first document after clear');
    assertCacheMiss(doc2, 'Should not find second document after clear');
  });

  test('should cache entries separately based on code-health-rules versions', async () => {
    const document = createMockDocument('/test/file.ts');

    addReview(document);
    assertCacheHit(document, 'Should retrieve review with empty code-health-rules snapshot');

    codeHealthFileVersions.set('/project/.codescene/code-health-rules.json', 1);
    assertCacheMiss(document, 'Should not find cache entry with different code-health-rules snapshot');

    addReview(document);
    assertCacheHit(document, 'Should retrieve review with new code-health-rules snapshot');
  });

  test('should cache entries separately when code-health-rules version changes', async () => {
    const document = createMockDocument('/test/file.ts');

    setRulesVersions({ '/project/.codescene/code-health-rules.json': 1 });
    addReview(document);
    assertCacheHit(document, 'Should retrieve review with version 1');

    setRulesVersions({ '/project/.codescene/code-health-rules.json': 2 });
    assertCacheMiss(document, 'Should not find cache entry with old code-health-rules version');

    addReview(document);
    assertCacheHit(document, 'Should retrieve review with version 2');
  });

  test('should handle multiple code-health-rules files', async () => {
    const document = createMockDocument('/test/file.ts');

    setRulesVersions({
      '/project1/.codescene/code-health-rules.json': 1,
      '/project2/.codescene/code-health-rules.json': 1
    });
    addReview(document);
    assertCacheHit(document, 'Should retrieve review with multiple rules files');

    codeHealthFileVersions.set('/project1/.codescene/code-health-rules.json', 2);
    assertCacheMiss(document, 'Should not find cache entry after one rules file version changed');
  });

  test('should handle code-health-rules file removal', async () => {
    const document = createMockDocument('/test/file.ts');

    setRulesVersions({ '/project/.codescene/code-health-rules.json': 1 });
    addReview(document);
    assertCacheHit(document, 'Should retrieve review with rules file');

    codeHealthFileVersions.delete('/project/.codescene/code-health-rules.json');
    assertCacheMiss(document, 'Should not find cache entry after rules file removed');
  });

  test('should cache multiple documents with same code-health-rules snapshot', async () => {
    const doc1 = createMockDocument('/test/file1.ts');
    const doc2 = createMockDocument('/test/file2.ts');

    setRulesVersions({ '/project/.codescene/code-health-rules.json': 1 });

    addReview(doc1);
    addReview(doc2);

    assertCacheHit(doc1, 'Should retrieve first document');
    assertCacheHit(doc2, 'Should retrieve second document');
  });

  test('should handle sorted code-health-rules files consistently', async () => {
    const document = createMockDocument('/test/file.ts');

    setRulesVersions({ '/b.json': 1, '/a.json': 1 });
    addReview(document);

    codeHealthFileVersions.clear();
    setRulesVersions({ '/a.json': 1, '/b.json': 1 });

    assertCacheHit(document, 'Should find cache entry regardless of insertion order due to sorting');
  });

  test('should delete all versions of a file from cache', async () => {
    const document = createMockDocument('/test/file.ts');

    addReview(document);

    setRulesVersions({ '/project/.codescene/code-health-rules.json': 1 });
    addReview(document);

    reviewCache.delete(document.fileName);

    codeHealthFileVersions.clear();
    assertCacheMiss(document, 'Should not find empty snapshot version');

    setRulesVersions({ '/project/.codescene/code-health-rules.json': 1 });
    assertCacheMiss(document, 'Should not find rules version');
  });

  suite('snapshotsEqual edge cases', () => {
    function createSnapshot(rules: Record<string, number>): Map<string, number> {
      return new Map(Object.entries(rules));
    }

    test('should return true for two empty snapshots', () => {
      const a = createSnapshot({});
      const b = createSnapshot({});
      assert.strictEqual(reviewCache.snapshotsEqual(a, b), true);
    });

    test('should return false for snapshots with different sizes', () => {
      const a = createSnapshot({ '/a.json': 1 });
      const b = createSnapshot({ '/a.json': 1, '/b.json': 1 });
      assert.strictEqual(reviewCache.snapshotsEqual(a, b), false);
    });

    test('should return false for snapshots with different filenames', () => {
      const a = createSnapshot({ '/a.json': 1 });
      const b = createSnapshot({ '/b.json': 1 });
      assert.strictEqual(reviewCache.snapshotsEqual(a, b), false);
    });

    test('should return false for snapshots with same filenames but different versions', () => {
      const a = createSnapshot({ '/a.json': 1 });
      const b = createSnapshot({ '/a.json': 2 });
      assert.strictEqual(reviewCache.snapshotsEqual(a, b), false);
    });

    test('should return true for identical snapshots with multiple files', () => {
      const a = createSnapshot({ '/a.json': 1, '/b.json': 2, '/c.json': 3 });
      const b = createSnapshot({ '/a.json': 1, '/b.json': 2, '/c.json': 3 });
      assert.strictEqual(reviewCache.snapshotsEqual(a, b), true);
    });

    test('should return false when one snapshot has extra file', () => {
      const a = createSnapshot({ '/a.json': 1, '/b.json': 2 });
      const b = createSnapshot({ '/a.json': 1, '/b.json': 2, '/c.json': 3 });
      assert.strictEqual(reviewCache.snapshotsEqual(a, b), false);
    });

    test('should return false when one snapshot is missing a file', () => {
      const a = createSnapshot({ '/a.json': 1, '/b.json': 2 });
      const b = createSnapshot({ '/a.json': 1 });
      assert.strictEqual(reviewCache.snapshotsEqual(a, b), false);
    });

    test('should return true for snapshots with same files in different insertion order', () => {
      const a = new Map();
      a.set('/z.json', 3);
      a.set('/a.json', 1);
      a.set('/m.json', 2);

      const b = new Map();
      b.set('/m.json', 2);
      b.set('/z.json', 3);
      b.set('/a.json', 1);

      assert.strictEqual(reviewCache.snapshotsEqual(a, b), true);
    });

    test('should return false for snapshots where all filenames match but one version differs', () => {
      const a = createSnapshot({ '/a.json': 1, '/b.json': 2, '/c.json': 3 });
      const b = createSnapshot({ '/a.json': 1, '/b.json': 99, '/c.json': 3 });
      assert.strictEqual(reviewCache.snapshotsEqual(a, b), false);
    });
  });

  suite('skipMonitorUpdate override behavior', () => {
    function getCacheEntry(document: vscode.TextDocument): { skipMonitorUpdate: boolean } | undefined {
      const cache = (reviewCache as any)._cache;
      const innerMap = cache.get(document.fileName);
      if (!innerMap) return undefined;

      const currentSnapshot = (reviewCache as any).createCodeHealthRulesSnapshot();
      for (const [snapshot, entry] of innerMap.entries()) {
        if (reviewCache.snapshotsEqual(snapshot, currentSnapshot)) {
          return entry;
        }
      }
      return undefined;
    }

    function testAddBehavior(initial: boolean, second: boolean, expected: boolean): void {
      const document = createMockDocument('/test/file.ts');

      reviewCache.add(document, createMockReview(document), initial);
      let entry = getCacheEntry(document);
      assert.ok(entry);
      assert.strictEqual(entry.skipMonitorUpdate, initial);

      reviewCache.add(document, createMockReview(document), second);
      entry = getCacheEntry(document);
      assert.ok(entry);
      assert.strictEqual(entry.skipMonitorUpdate, expected);
    }

    function testUpdateBehavior(initial: boolean, second: boolean, expected: boolean): void {
      const document = createMockDocument('/test/file.ts');

      reviewCache.add(document, createMockReview(document), initial);
      let entry = getCacheEntry(document);
      assert.ok(entry);
      assert.strictEqual(entry.skipMonitorUpdate, initial);

      const updated = reviewCache.update(document, createMockReview(document), second);
      assert.strictEqual(updated, true);

      entry = getCacheEntry(document);
      assert.ok(entry);
      assert.strictEqual(entry.skipMonitorUpdate, expected);
    }

    test('should override skipMonitorUpdate true with false when adding', async () => {
      testAddBehavior(true, false, false);
    });

    test('should not override skipMonitorUpdate false with true when adding', async () => {
      testAddBehavior(false, true, false);
    });

    test('should override skipMonitorUpdate true with false when updating', async () => {
      testUpdateBehavior(true, false, false);
    });

    test('should not override skipMonitorUpdate false with true when updating', async () => {
      testUpdateBehavior(false, true, false);
    });

    test('should keep skipMonitorUpdate true when both are true', async () => {
      testUpdateBehavior(true, true, true);
    });

    test('should keep skipMonitorUpdate false when both are false', async () => {
      testUpdateBehavior(false, false, false);
    });
  });

  suite('pruneDeletedFiles', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let tempDir: string;

    setup(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cache-test-'));
    });

    teardown(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    function createTempFilePath(filename: string): string {
      return path.join(tempDir, filename);
    }

    function createExistingFile(filename: string, content: string = 'export const test = 1;'): string {
      const filePath = createTempFilePath(filename);
      fs.writeFileSync(filePath, content);
      return filePath;
    }

    function addDocumentToCache(filePath: string): vscode.TextDocument {
      const document = createMockDocument(filePath);
      addReview(document);
      return document;
    }

    async function pruneAndWait(): Promise<void> {
      reviewCache.pruneDeletedFiles();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    test('should keep cache entries for files that exist', async () => {
      const document = addDocumentToCache(createExistingFile('existing.ts'));

      await pruneAndWait();

      assert.ok(reviewCache.get(document, false), 'Existing file should stay in the cache');
    });

    test('should remove cache entry for non-existent file', async () => {
      const document = addDocumentToCache(createTempFilePath('to-be-deleted.ts'));
      assert.ok(reviewCache.get(document, false), 'Cache item should exist before pruning');

      await pruneAndWait();

      assert.strictEqual(reviewCache.get(document, false), undefined, 'Cache item should be removed');
    });

    test('should remove all versions of a file when none exist', async () => {
      const document = createMockDocument(createTempFilePath('multi-version.ts'));

      addReview(document);
      setRulesVersions({ '/project/.codescene/code-health-rules.json': 1 });
      addReview(document);
      setRulesVersions({ '/project/.codescene/code-health-rules.json': 2 });
      addReview(document);

      assert.ok(reviewCache.get(document, false), 'Cache item should exist before pruning');

      await pruneAndWait();

      assert.strictEqual(reviewCache.get(document, false), undefined, 'All versions should be removed');

      codeHealthFileVersions.clear();
      assert.strictEqual(reviewCache.get(document, false), undefined, 'Empty snapshot version should also be removed');

      setRulesVersions({ '/project/.codescene/code-health-rules.json': 1 });
      assert.strictEqual(reviewCache.get(document, false), undefined, 'Version 1 snapshot should also be removed');
    });

    test('should handle mixed scenario with existing and non-existing files', async () => {
      const existingDoc = addDocumentToCache(createExistingFile('existing.ts'));
      const nonExistentDoc = addDocumentToCache(createTempFilePath('nonexistent.ts'));

      await pruneAndWait();

      assert.ok(reviewCache.get(existingDoc, false), 'Existing file should still be in cache');
      assert.strictEqual(
        reviewCache.get(nonExistentDoc, false),
        undefined,
        'Non-existent file should be removed from cache'
      );
    });
  });
});
