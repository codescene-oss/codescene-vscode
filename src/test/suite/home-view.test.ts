import * as assert from 'assert';
import * as path from 'path';
import { Uri } from '../mocks/vscode';
import { HomeView } from '../../code-health-monitor/home/home-view';
import { BackgroundServiceView } from '../../code-health-monitor/background-view';
import { CsExtensionState } from '../../cs-extension-state';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { FileWithIssues } from '../../code-health-monitor/file-with-issues';
import { getMessageCategory } from '../../code-health-monitor/home/cwf-message-categories';
import {
  clearMockGitRepositories,
  createMockWebviewView,
  getWebviewMessageHandler,
  getWebviewPostMessageCalls,
  resetWebviewPanelMocks,
  setMockGitRepositories,
  type MockWebviewView,
} from '../setup';
import { setCwfAuth } from '../../auth/cwf-auth';
import type { AuthSurface } from '../../auth/auth-flow';
import type { AuthFlow } from '../../centralized-webview-framework/types/auth';
import { flushPromises } from '../fakes/fake-auth-transport';
import { authPayloadFixture } from '../fixtures/auth/auth-fixtures';

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

suite('HomeView auth surface', () => {
  const payload = authPayloadFixture('auth-payload-linked-project');
  const flow: AuthFlow = { step: 'summary', context: 'sign-in', 'project-source': null, syncing: false };
  const filePath = '/workspace/monitored.ts';
  let homeView: HomeView;
  let view: MockWebviewView;

  type Rendered = { messageType: string; payload: { view: string; auth?: unknown; data?: any } };

  suiteSetup(() => {
    if (!CsExtensionState.hasInstance) {
      CsExtensionState.init(createMockExtensionContext(path.join(__dirname, '../../../test-home-view-repo')));
    }
  });

  setup(() => {
    resetWebviewPanelMocks();
    setCwfAuth(payload, flow, 'monitor');
    homeView = new HomeView(createMockExtensionContext('/repo'), { updateBadge: () => {}, dispose: () => {} } as any);
    view = createMockWebviewView();
  });

  teardown(() => {
    homeView.update.cancel();
    homeView.dispose();
    setCwfAuth(undefined);
    resetWebviewPanelMocks();
  });

  async function render() {
    homeView.update.flush();
    await flushPromises();
  }

  async function resolve() {
    homeView.resolveWebviewView(view as any, {} as any, {} as any);
    await render();
  }

  async function initialize() {
    await resolve();
    await sendInit();
  }

  async function showSurface(surface: AuthSurface) {
    setCwfAuth(payload, flow, surface);
    await render();
  }

  async function addMonitoredFile() {
    (homeView as any).handleDeltaUpdate({
      document: { uri: Uri.file(filePath), fileName: filePath },
      result: { 'old-score': 9.0, 'new-score': 8.0, 'score-change': -1.0, 'file-level-findings': [], 'function-level-findings': [] },
      updateMonitor: true,
    });
    await render();
  }

  function lastRendered(): Rendered {
    return getWebviewPostMessageCalls().at(-1) as Rendered;
  }

  function monitoredFiles(rendered: Rendered): string[] {
    return rendered.payload.data.fileDeltaData.map((item: { file: { fileName: string } }) => item.file.fileName);
  }

  test('posts the auth view while the surface is auth', async () => {
    await initialize();
    await showSurface('auth');
    assert.strictEqual(lastRendered().messageType, 'update-renderer');
    assert.strictEqual(lastRendered().payload.view, 'auth');
    assert.deepStrictEqual(lastRendered().payload.auth, payload);
  });

  test('returns to the monitor with the monitor data gathered while the auth view was shown', async () => {
    await initialize();
    await showSurface('auth');
    await addMonitoredFile();
    assert.strictEqual(lastRendered().payload.view, 'auth');
    await showSurface('monitor');
    assert.strictEqual(lastRendered().payload.view, 'home');
    assert.deepStrictEqual(monitoredFiles(lastRendered()), [filePath]);
  });

  const visibilityCases: Array<{ name: string; surfaces: AuthSurface[]; expected: string[] }> = [
    { name: 'the auth view while the surface is auth', surfaces: ['auth'], expected: ['"view":"auth"'] },
    {
      name: 'the monitor with current data after returning from auth',
      surfaces: ['auth', 'monitor'],
      expected: ['"view":"home"', filePath],
    },
  ];

  for (const { name, surfaces, expected } of visibilityCases) {
    test(`a visibility reset rebuilds the HTML as ${name}`, async () => {
      await initialize();
      await addMonitoredFile();
      for (const surface of surfaces) await showSurface(surface);
      view.setVisible(false);
      for (const fragment of expected) assert.ok(view.webview.html.includes(fragment), fragment);
    });
  }

  async function sendInit() {
    await getWebviewMessageHandler()!({ messageType: 'init', payload: 'home' });
    await render();
  }

  const initCases: Array<{ name: string; arrange: () => Promise<void> }> = [
    {
      name: 'a file added while hidden after returning from auth',
      arrange: async () => {
        await initialize();
        await showSurface('auth');
        view.setVisible(false);
        await showSurface('monitor');
        await addMonitoredFile();
        view.setVisible(true);
      },
    },
    {
      name: 'a file added between resolve and init',
      arrange: async () => {
        await resolve();
        await addMonitoredFile();
      },
    },
  ];

  for (const { name, arrange } of initCases) {
    test(`init posts the current monitor data including ${name}`, async () => {
      await arrange();
      getWebviewPostMessageCalls().length = 0;
      await sendInit();
      assert.strictEqual(lastRendered().payload.view, 'home');
      assert.deepStrictEqual(monitoredFiles(lastRendered()), [filePath]);
    });
  }

  test('showing the view again keeps the HTML it was given while hidden', async () => {
    await initialize();
    await showSurface('auth');
    view.setVisible(false);
    const hidden = view.webview.html;
    view.setVisible(true);
    await render();
    assert.strictEqual(view.webview.html, hidden);
  });

  test('renders the auth HTML on first resolve after an earlier surface change', async () => {
    await showSurface('auth');
    await resolve();
    assert.ok(view.webview.html.includes('"view":"auth"'), view.webview.html);
  });

  test('a surface change before init replaces the HTML, other updates keep it', async () => {
    await resolve();
    const monitorHtml = view.webview.html;
    await addMonitoredFile();
    assert.strictEqual(view.webview.html, monitorHtml);
    await showSurface('auth');
    assert.ok(view.webview.html.includes('"view":"auth"'), view.webview.html);
  });

  test('stays on the monitor when the surface is auth but browser sign-in is inactive', async () => {
    setCwfAuth(undefined, undefined, 'auth');
    await initialize();
    assert.ok(view.webview.html.includes('"view":"home"'), view.webview.html);
    assert.strictEqual(lastRendered().payload.view, 'home');
    assert.ok(!view.webview.html.includes('ide-auth'));
  });
});

suite('Home view legacy login messages', () => {
  for (const messageType of ['open-login', 'init-login', 'open-home']) {
    test(`${messageType} is not handled by the home view`, () => {
      assert.strictEqual(getMessageCategory(messageType), 'unknown');
    });
  }
});
