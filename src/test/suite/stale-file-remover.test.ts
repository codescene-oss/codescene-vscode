import * as assert from 'assert';
import { StaleFileRemover } from '../../code-health-monitor/stale-file-remover';

suite('StaleFileRemover', () => {
  let remover: StaleFileRemover;

  setup(() => {
    remover = new StaleFileRemover();
  });

  suite('findStaleFiles', () => {
    const testCases = [
      {
        name: 'empty map returns empty',
        mapKeys: [] as string[],
        changed: [] as string[],
        visible: [] as string[],
        expected: [] as string[],
      },
      {
        name: 'file in changed set is not stale',
        mapKeys: ['/workspace/a.ts'],
        changed: ['/workspace/a.ts'],
        visible: [],
        expected: [],
      },
      {
        name: 'file in visible set is not stale',
        mapKeys: ['/workspace/a.ts'],
        changed: [],
        visible: ['/workspace/a.ts'],
        expected: [],
      },
      {
        name: 'file in neither set is stale',
        mapKeys: ['/workspace/a.ts'],
        changed: [],
        visible: [],
        expected: ['/workspace/a.ts'],
      },
      {
        name: 'file in both sets is not stale',
        mapKeys: ['/workspace/a.ts'],
        changed: ['/workspace/a.ts'],
        visible: ['/workspace/a.ts'],
        expected: [],
      },
      {
        name: 'multiple files - mixed stale and non-stale',
        mapKeys: ['/workspace/a.ts', '/workspace/b.ts', '/workspace/c.ts'],
        changed: ['/workspace/a.ts'],
        visible: ['/workspace/b.ts'],
        expected: ['/workspace/c.ts'],
      },
      {
        name: 'all files stale when both sets empty',
        mapKeys: ['/workspace/a.ts', '/workspace/b.ts'],
        changed: [],
        visible: [],
        expected: ['/workspace/a.ts', '/workspace/b.ts'],
      },
      {
        name: 'no files stale when all in changed set',
        mapKeys: ['/workspace/a.ts', '/workspace/b.ts'],
        changed: ['/workspace/a.ts', '/workspace/b.ts'],
        visible: [],
        expected: [],
      },
    ];

    testCases.forEach(({ name, mapKeys, changed, visible, expected }) => {
      test(name, () => {
        const fileIssueMap = new Map<string, unknown>();
        mapKeys.forEach((key) => fileIssueMap.set(key, {}));

        const result = remover.findStaleFiles(fileIssueMap, new Set(changed), new Set(visible));

        assert.deepStrictEqual(result.sort(), expected.sort());
      });
    });
  });

  suite('path normalization', () => {
    const normalizationCases = [
      {
        name: 'matches paths with same separators',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace/src/file.ts',
        shouldBeStale: false,
      },
      {
        name: 'matches paths with redundant slashes',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace//src/file.ts',
        shouldBeStale: false,
      },
      {
        name: 'matches paths with dot segments',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace/src/./file.ts',
        shouldBeStale: false,
      },
      {
        name: 'matches paths with parent traversal',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace/src/sub/../file.ts',
        shouldBeStale: false,
      },
    ];

    normalizationCases.forEach(({ name, mapPath, changedPath, shouldBeStale }) => {
      test(name, () => {
        const fileIssueMap = new Map<string, unknown>();
        fileIssueMap.set(mapPath, {});

        const result = remover.findStaleFiles(fileIssueMap, new Set([changedPath]), new Set());

        if (shouldBeStale) {
          assert.strictEqual(result.length, 1, `Expected ${mapPath} to be stale`);
        } else {
          assert.strictEqual(result.length, 0, `Expected ${mapPath} to NOT be stale when matched via ${changedPath}`);
        }
      });
    });
  });
});
