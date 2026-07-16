import * as assert from 'assert';
import * as path from 'path';
import { Uri } from '../mocks/vscode';
import { HomeView } from '../../code-health-monitor/home/home-view';
import { BackgroundServiceView } from '../../code-health-monitor/background-view';
import { CsExtensionState } from '../../cs-extension-state';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { FileWithIssues } from '../../code-health-monitor/file-with-issues';

suite('HomeView', () => {
  suite('removeStaleFiles', () => {
    let homeView: HomeView;
    let mockBackgroundServiceView: BackgroundServiceView;
    let mockContext: ReturnType<typeof createMockExtensionContext>;

    const mockDocument = (filePath: string) => ({
      uri: Uri.file(filePath),
      fileName: filePath,
    } as any);

    const mockDeltaResult = {
      'old-score': 9.0,
      'new-score': 8.0,
      'score-change': -1.0,
      'file-level-findings': [],
      'function-level-findings': [],
    };

    suiteSetup(() => {
      const testRepoPath = path.join(__dirname, '../../../test-home-view-repo');
      mockContext = createMockExtensionContext(testRepoPath);
      if (!CsExtensionState.hasInstance) {
        CsExtensionState.init(mockContext);
      }
    });

    setup(() => {
      mockBackgroundServiceView = {
        updateBadge: () => {},
        dispose: () => {},
      } as any;
      homeView = new HomeView(mockContext, mockBackgroundServiceView);
    });

    teardown(() => {
      homeView.getFileIssueMap().clear();
    });

    function addFileToHomeView(filePath: string) {
      const doc = mockDocument(filePath);
      const fileWithIssues = new FileWithIssues(mockDeltaResult, doc);
      homeView.getFileIssueMap().set(filePath, fileWithIssues);
    }

    const testCases = [
      {
        name: 'empty fileIssueMap, empty changedFiles, empty visibleFiles - no changes',
        initialFiles: [] as string[],
        changedFiles: [] as string[],
        visibleFiles: [] as string[],
        expectedFiles: [] as string[],
      },
      {
        name: 'empty fileIssueMap, has changedFiles, empty visibleFiles - no changes',
        initialFiles: [],
        changedFiles: ['/workspace/file1.ts'],
        visibleFiles: [],
        expectedFiles: [],
      },
      {
        name: 'has files A,B in map, changedFiles has A,B - keeps A,B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        visibleFiles: [],
        expectedFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
      },
      {
        name: 'has files A,B in map, changedFiles has only A - removes B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: ['/workspace/fileA.ts'],
        visibleFiles: [],
        expectedFiles: ['/workspace/fileA.ts'],
      },
      {
        name: 'has files A,B in map, changedFiles empty, visibleFiles has A - removes B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: [],
        visibleFiles: ['/workspace/fileA.ts'],
        expectedFiles: ['/workspace/fileA.ts'],
      },
      {
        name: 'has files A,B in map, changedFiles has B, visibleFiles has A - keeps A,B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: ['/workspace/fileB.ts'],
        visibleFiles: ['/workspace/fileA.ts'],
        expectedFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
      },
      {
        name: 'has files A,B in map, changedFiles empty, visibleFiles empty - removes A,B',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
        changedFiles: [],
        visibleFiles: [],
        expectedFiles: [],
      },
      {
        name: 'has files A,B,C in map, changedFiles has A, visibleFiles has B - removes C',
        initialFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts', '/workspace/fileC.ts'],
        changedFiles: ['/workspace/fileA.ts'],
        visibleFiles: ['/workspace/fileB.ts'],
        expectedFiles: ['/workspace/fileA.ts', '/workspace/fileB.ts'],
      },
    ];

    testCases.forEach(({ name, initialFiles, changedFiles, visibleFiles, expectedFiles }) => {
      test(name, () => {
        initialFiles.forEach(addFileToHomeView);

        homeView.removeStaleFiles(new Set(changedFiles), new Set(visibleFiles));

        const fileIssueMap = homeView.getFileIssueMap();
        assert.strictEqual(fileIssueMap.size, expectedFiles.length);
        expectedFiles.forEach(file => assert.ok(fileIssueMap.has(file), `Expected ${file} to be in map`));
      });
    });

    const pathNormalizationCases = [
      {
        name: 'matches paths with same separators',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace/src/file.ts',
      },
      {
        name: 'matches paths with redundant slashes',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace//src/file.ts',
      },
      {
        name: 'matches paths with dot segments',
        mapPath: '/workspace/src/file.ts',
        changedPath: '/workspace/src/./file.ts',
      },
    ];

    pathNormalizationCases.forEach(({ name, mapPath, changedPath }) => {
      test(`path normalization: ${name}`, () => {
        addFileToHomeView(mapPath);

        homeView.removeStaleFiles(new Set([changedPath]), new Set());

        const fileIssueMap = homeView.getFileIssueMap();
        assert.strictEqual(fileIssueMap.size, 1, `Expected file to be kept when matching via ${changedPath}`);
      });
    });

    test('calls updateBadge when files are removed', () => {
      let badgeUpdateCalled = false;
      mockBackgroundServiceView.updateBadge = () => {
        badgeUpdateCalled = true;
      };

      addFileToHomeView('/workspace/fileA.ts');
      addFileToHomeView('/workspace/fileB.ts');

      homeView.removeStaleFiles(new Set(), new Set());

      assert.ok(badgeUpdateCalled, 'Expected updateBadge to be called when files are removed');
    });

    test('does not call updateBadge when no files are removed', () => {
      let badgeUpdateCalled = false;
      mockBackgroundServiceView.updateBadge = () => {
        badgeUpdateCalled = true;
      };

      addFileToHomeView('/workspace/fileA.ts');

      homeView.removeStaleFiles(new Set(['/workspace/fileA.ts']), new Set());

      assert.ok(!badgeUpdateCalled, 'Expected updateBadge not to be called when no files are removed');
    });

    test('updates badge with correct count when files removed', () => {
      let badgeCount: number | undefined;
      mockBackgroundServiceView.updateBadge = (count: number) => {
        badgeCount = count;
      };

      addFileToHomeView('/workspace/fileA.ts');
      addFileToHomeView('/workspace/fileB.ts');
      addFileToHomeView('/workspace/fileC.ts');

      homeView.removeStaleFiles(new Set(['/workspace/fileA.ts']), new Set());

      assert.strictEqual(badgeCount, 1, 'Expected badge count to be 1 after removing 2 files');
    });
  });
});
