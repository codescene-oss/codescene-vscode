import * as assert from 'assert';
import * as path from 'path';
import { Uri } from '../mocks/vscode';
import { HomeView } from '../../code-health-monitor/home/home-view';
import { BackgroundServiceView } from '../../code-health-monitor/background-view';
import { CsExtensionState } from '../../cs-extension-state';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { FileWithIssues } from '../../code-health-monitor/file-with-issues';
import { handleCWFMessage } from '../../code-health-monitor/home/cwf-message-handlers';
import { clearMockGitRepositories, setMockGitRepositories } from '../setup';

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

        homeView.removeStaleFiles(new Set(changedFiles), new Set(visibleFiles), new Set());

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

        homeView.removeStaleFiles(new Set([changedPath]), new Set(), new Set());

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

      homeView.removeStaleFiles(new Set(), new Set(), new Set());

      assert.ok(badgeUpdateCalled, 'Expected updateBadge to be called when files are removed');
    });

    test('does not call updateBadge when no files are removed', () => {
      let badgeUpdateCalled = false;
      mockBackgroundServiceView.updateBadge = () => {
        badgeUpdateCalled = true;
      };

      addFileToHomeView('/workspace/fileA.ts');

      homeView.removeStaleFiles(new Set(['/workspace/fileA.ts']), new Set(), new Set());

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

      homeView.removeStaleFiles(new Set(['/workspace/fileA.ts']), new Set(), new Set());

      assert.strictEqual(badgeCount, 1, 'Expected badge count to be 1 after removing 2 files');
    });

    test('clears monitored files when analysis is stopped', () => {
      let badgeCount: number | undefined;
      mockBackgroundServiceView.updateBadge = (count: number) => {
        badgeCount = count;
      };

      addFileToHomeView('/workspace/fileA.ts');
      addFileToHomeView('/workspace/fileB.ts');

      (homeView as any).setStoppedAnalysis();

      assert.strictEqual(homeView.getFileIssueMap().size, 0);
      assert.deepStrictEqual((homeView as any).ideContextData.fileDeltaData, []);
      assert.strictEqual((homeView as any).ideContextData.analysisState, 'stopped');
      assert.strictEqual(badgeCount, 0);
    });

    const enrichmentCases = [
      {
        name: 'adds a file on its first delta',
        initialFiles: [] as string[],
        enrichment: false,
        expectedFiles: ['/workspace/fileA.ts'],
      },
      {
        name: 'does not resurrect a file removed while its delta was being enriched',
        initialFiles: [] as string[],
        enrichment: true,
        expectedFiles: [] as string[],
      },
      {
        name: 'updates a file that is still monitored when its enriched delta arrives',
        initialFiles: ['/workspace/fileA.ts'],
        enrichment: true,
        expectedFiles: ['/workspace/fileA.ts'],
      },
    ];

    enrichmentCases.forEach(({ name, initialFiles, enrichment, expectedFiles }) => {
      test(name, () => {
        initialFiles.forEach(addFileToHomeView);

        (homeView as any).updateFileDeltaData({
          document: mockDocument('/workspace/fileA.ts'),
          result: mockDeltaResult,
          updateMonitor: true,
          enrichment,
        });

        assert.deepStrictEqual([...homeView.getFileIssueMap().keys()], expectedFiles);
      });
    });
  });

  suite('review progress', () => {
    let homeView: HomeView;
    const root = path.join('/repo');

    setup(() => {
      const mockContext = createMockExtensionContext(root);
      if (!CsExtensionState.hasInstance) {
        CsExtensionState.init(mockContext);
      }
      setMockGitRepositories([{ rootUri: { fsPath: root } }]);
      homeView = new HomeView(mockContext, { updateBadge: () => {}, dispose: () => {} } as any);
    });

    teardown(() => {
      clearMockGitRepositories();
    });

    const cases: Array<{
      name: string;
      event: {
        state: 'running' | 'idle';
        jobs: string[];
        queued: string[];
        queueCount: number;
        queueDone: number;
      };
      analysisState: 'running' | 'idle';
      remainingCount: number;
      totalCount?: number;
      jobs: Array<{ fileName: string; state: 'running' | 'queued' }>;
    }> = [
      {
        name: 'shows remaining, total, and the job list from review progress',
        event: {
          state: 'running',
          jobs: [path.join(root, 'dirty.ts')],
          queued: ['a.ts'],
          queueCount: 2,
          queueDone: 1,
        },
        analysisState: 'running',
        remainingCount: 3,
        totalCount: 4,
        jobs: [
          { fileName: path.join(root, 'a.ts'), state: 'queued' },
          { fileName: path.join(root, 'dirty.ts'), state: 'running' },
        ],
      },
      {
        name: 'clears the counts when the batch has drained',
        event: { state: 'idle', jobs: [], queued: [], queueCount: 0, queueDone: 3 },
        analysisState: 'idle',
        remainingCount: 0,
        jobs: [],
      },
    ];

    for (const { name, event, analysisState, remainingCount, totalCount, jobs } of cases) {
      test(name, () => {
        (homeView as any).applyAnalysisEvent({ ...event, jobs: new Set(event.jobs) });
        const data = (homeView as any).ideContextData;
        assert.strictEqual(data.analysisState, analysisState);
        assert.strictEqual(data.remainingCount, remainingCount);
        assert.strictEqual(data.totalCount, totalCount);
        assert.deepStrictEqual(
          data.jobs.map((job: { file: { fileName: string }; state: string }) => ({
            fileName: job.file.fileName,
            state: job.state,
          })),
          jobs
        );
      });
    }
  });
});

suite('Home view login messages', () => {
  test('open-login opens the login flow', async () => {
    const states: Array<{ loginOpen: boolean; loginState: string }> = [];
    const homeView = {
      setLoginFlowState: (state: { loginOpen: boolean; loginState: string }) => {
        states.push(state);
      },
    };

    await handleCWFMessage(homeView as HomeView, { messageType: 'open-login' });

    assert.deepStrictEqual(states, [{ loginOpen: true, loginState: 'init' }]);
  });
});
