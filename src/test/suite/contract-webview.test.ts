/* eslint-disable @typescript-eslint/naming-convention */
/**
 * D11 / R12, the webview boundary: what VS Code sends to the webview validates against `webview-schema.json`
 * (`IdeContextType`) and what the webview sends to VS Code against `message-schema.json` (`MessageToIDEType`),
 * both from the bundled CWF zip (cs-cwf/). The schemas are closed, so every payload is also checked to fail
 * once it carries a field the webview does not declare.
 *
 * The payloads come from the production builders (home view props, docs data, delta presentation, auth payload),
 * fed with the entity-form fixtures of the CS IDE contract bundle. The messages come from the extension's own
 * samples (src/test/fixtures/webview-messages.ts), run through the production message handlers. ACE views and
 * ACE messages are not exercised.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { aceTest } from '../ace-test-suite';
import { registerAuthMessages, routeAuthMessage, type AuthActions, type AuthMessageTarget } from '../../auth/auth-message-handler';
import { AuthSnapshot, INACTIVE_SNAPSHOT, toAuthFlow, toAuthPayload } from '../../auth/auth-payload';
import { authViewProps } from '../../auth/auth-view-props';
import { setCwfAuth, withCwfAuth } from '../../auth/cwf-auth';
import { BackgroundServiceView } from '../../code-health-monitor/background-view';
import { handleCWFMessage } from '../../code-health-monitor/home/cwf-message-handlers';
import { HomeView } from '../../code-health-monitor/home/home-view';
import { updateRendererMessage } from '../../centralized-webview-framework/cwf-html-utils';
import type { HomeContextViewProps } from '../../centralized-webview-framework/types';
import type { Account, AuthStatus, Project } from '../../centralized-webview-framework/types/auth';
import type { FunctionInfoExternal } from '../../centralized-webview-framework/types/delta';
import type { MessageToIDEType } from '../../centralized-webview-framework/types/messages';
import { CodeSceneCWFDocsTabPanel } from '../../codescene-tab/webview/documentation/cwf-webview-docs-panel';
import { getDocsData } from '../../codescene-tab/webview/documentation/docs-data-mapper';
import { CsExtensionState } from '../../cs-extension-state';
import { DevtoolsAPI } from '../../devtools-api';
import { Delta } from '../../devtools-api/delta-model';
import { FnToRefactor } from '../../devtools-api/refactor-models';
import { Review } from '../../devtools-api/review-model';
import { InteractiveDocsParams, toDocsParamsRanged } from '../../documentation/commands';
import { initExtensionId } from '../../extension-id';
import { fixture, fixtureVariants } from '../contract/contract';
import { flushPromises } from '../fakes/fake-auth-transport';
import { useCwfDir, validateWebviewMessage, validateWebviewPayload } from '../contract/webview';
import { authMessageSamples, docsMessageSamples, homeMessageSamples } from '../fixtures/webview-messages';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { TestTextDocument } from '../mocks/test-text-document';
import {
  getWebviewMessageHandler,
  getWebviewPostMessageCalls,
  resetWebviewPanelMocks,
  restoreDefaultConfiguration,
  clearMockGitRepositories,
  setMockGitRepositories,
} from '../setup';

const REPO = '/fake/repo';
const FILE = `${REPO}/src/fake.js`;
const FAKE_FUNCTION_LINES = ['// fake.js', '', 'function fakeFunction() {', '  if (a) {', '    return 1;', '  }', '  return 2;', '  // end', '}', ''];
const fakeSource = () => new TestTextDocument(FILE, FAKE_FUNCTION_LINES.join('\n'), 'javascript');
const addRefactorableFunctions = (document: vscode.TextDocument, delta: Delta) =>
  (DevtoolsAPI as unknown as { addRefactorableFunctions: (d: vscode.TextDocument, r: Delta) => void }).addRefactorableFunctions(document, delta);

type Json = Record<string, any>;

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * Both payloads and messages are closed: `payload` validates, and fails once an undeclared field is added
 * at the top level or to the nested object `locate` finds.
 */
function assertValidAndClosed(
  payload: unknown,
  validate: (value: unknown) => void,
  locate: (copy: any) => Json | undefined
): void {
  validate(payload);

  const topLevel = cloneJson(payload) as Json;
  topLevel.undeclaredField = true;
  assert.throws(() => validate(topLevel), /undeclaredField/, 'an undeclared top-level field must fail');

  const nested = cloneJson(payload);
  const nestedObject = locate(nested);
  if (nestedObject) {
    nestedObject.undeclaredField = true;
    assert.throws(() => validate(nested), /undeclaredField/, 'an undeclared nested field must fail');
  }
}

const assertPayloadClosed = (payload: unknown, locate: (copy: any) => Json) =>
  assertValidAndClosed(payload, validateWebviewPayload, locate);

/** The payload of a message, when it is an object that can carry an undeclared field. */
const messagePayload = (copy: any): Json | undefined => (typeof copy.payload === 'object' && copy.payload !== null ? copy.payload : undefined);

// ---- Harness ----------------------------------------------------------------------------------------------------

suite('Contract webview harness Test Suite', () => {
  let emptyDir: string;

  setup(() => {
    emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-missing-'));
  });

  teardown(() => {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  test('a missing webview-schema.json is a failure that names how to get it', () => {
    const restore = useCwfDir(emptyDir);
    try {
      assert.throws(() => validateWebviewPayload({}), /webview-schema\.json is missing.*npm run updatecwf/s);
    } finally {
      restore();
    }
  });

  test('a missing message-schema.json is a failure that names how to get it', () => {
    const restore = useCwfDir(emptyDir);
    try {
      assert.throws(() => validateWebviewMessage({}), /message-schema\.json is missing.*npm run updatecwf/s);
    } finally {
      restore();
    }
  });

  test('both test jobs of the test workflow fetch the CWF with the webview token before pretest', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'test.yml'), 'utf8');
    const jobs = workflow.split(/^  (?=build:|test-no-ace:)/m).slice(1);
    assert.strictEqual(jobs.length, 2);
    for (const job of jobs) {
      const lines = job.split(/\r?\n/).map((line) => line.trim());
      const fetchAt = lines.indexOf('run: npm run updatecwf');
      const pretestAt = lines.indexOf('- run: npm run pretest');
      assert.ok(fetchAt >= 0 && fetchAt < pretestAt, 'updatecwf must run before pretest');
      assert.ok(
        lines.slice(fetchAt, pretestAt).includes('GITHUB_TOKEN: ${{ secrets.CODESCENE_IDE_DOCS_AND_WEBVIEW_TOKEN }}'),
        'updatecwf needs the webview token'
      );
    }
  });

  test('the payload schema is closed and rooted at the views', () => {
    validateWebviewPayload({ ideType: 'VSCode', view: 'auth' });
    assert.throws(() => validateWebviewPayload({ ideType: 'VSCode', view: 'auth', undeclaredField: 1 }), /undeclaredField/);
    assert.throws(() => validateWebviewPayload({ ideType: 'VSCode', view: 'nonexistent' }));
  });

  test('the message schema is closed and rooted at the message types', () => {
    validateWebviewMessage({ messageType: 'open-settings' });
    assert.throws(() => validateWebviewMessage({ messageType: 'open-settings', undeclaredField: 1 }), /undeclaredField/);
    assert.throws(() => validateWebviewMessage({ messageType: 'nonexistent' }));
  });
});

// ---- Payloads the extension sends --------------------------------------------------------------------------------

suite('Contract webview payloads Test Suite', () => {
  let mockContext: vscode.ExtensionContext;

  suiteSetup(() => {
    initExtensionId({ extension: { id: 'CodeScene.codescene-vscode' } } as vscode.ExtensionContext);
  });

  setup(() => {
    mockContext = createMockExtensionContext('/test/contract-webview');
    CsExtensionState.init(mockContext);
    resetWebviewPanelMocks();
  });

  teardown(() => {
    setCwfAuth(undefined);
    resetWebviewPanelMocks();
  });

  /** ACE as it is when the user is signed in and ACE is switched on: the credential comes with the sign-in. */
  function enableAce(): void {
    CsExtensionState.setACEState({ state: 'enabled' });
    CsExtensionState.setAuth({ active: true, status: fixture('auth-status', 'signed-in', 'entity') });
  }

  function deltaWithRefactorableFunctions(delta: Delta): Delta {
    addRefactorableFunctions(fakeSource(), delta);
    return delta;
  }

  // ---- Home view props ----

  suite('home view props', () => {
    let homeView: HomeView;

    const backgroundServiceView = { updateBadge: () => {}, dispose: () => {} } as unknown as BackgroundServiceView;

    setup(() => {
      homeView = new HomeView(mockContext, backgroundServiceView);
      setMockGitRepositories([{ rootUri: { fsPath: REPO } }]);
    });

    teardown(() => {
      clearMockGitRepositories();
    });


    const addDelta = (delta: Delta) =>
      homeView['updateFileDeltaData']({ document: new TestTextDocument(FILE, '', 'javascript'), result: delta, updateMonitor: true });

    const homePayload = (): any => homeView['homePayload']();

    const firstDelta = (copy: any) => copy.data.fileDeltaData[0].delta;

    for (const variant of fixtureVariants('delta')) {
      test(`the ${variant} delta fixture validates and is closed`, () => {
        addDelta(fixture('delta', variant, 'entity'));
        const payload = homePayload();
        assert.strictEqual(payload.data.fileDeltaData.length, 1);
        assertPayloadClosed(payload, firstDelta);
        assertPayloadClosed(updateRendererMessage(payload).payload, (copy) => copy.data);
      });

    }

    // Only a finding with a function range can be matched with a refactorable function (see fnToRefactorForFinding), so the minimal fixture has none.
    test('the full delta fixture with a refactorable function validates and is closed', async () => {
      addDelta(deltaWithRefactorableFunctions(fixture('delta', 'full', 'entity')));
      const payload = homePayload();
      const finding = firstDelta(payload)['function-level-findings'][0];
      assert.deepStrictEqual(Object.keys(finding).sort(), ['change-details', 'function', 'refactorable-fn']);
      assertPayloadClosed(payload, (copy) => firstDelta(copy)['function-level-findings'][0]['refactorable-fn']);
    });

    test('the minimal delta fixture has no refactorable function to hand over', async () => {
      addDelta(deltaWithRefactorableFunctions(fixture('delta', 'minimal', 'entity')));
      const finding = firstDelta(homePayload())['function-level-findings'][0];
      assert.deepStrictEqual(Object.keys(finding).sort(), ['change-details', 'function']);
    });

    test('the refactorable function keeps what the webview declares and drops what the extension adds', async () => {
      addDelta(deltaWithRefactorableFunctions(fixture('delta', 'full', 'entity')));
      const { 'refactorable-fn': fn } = firstDelta(homePayload())['function-level-findings'][0];
      assert.deepStrictEqual(fn, {
        name: 'fakeFunction',
        body: FAKE_FUNCTION_LINES.slice(2, 9).join('\n'),
        'file-type': 'js',
        range: { 'start-line': 3, 'start-column': 1, 'end-line': 9, 'end-column': 2 },
        'refactoring-targets': [{ category: 'Complex Method', line: 3 }],
      });
    });

    test('a finding without a refactorable function has none in the payload', () => {
      addDelta(fixture('delta', 'full', 'entity'));
      const finding = firstDelta(homePayload())['function-level-findings'][0];
      assert.ok(!('refactorable-fn' in finding) && !('refactorableFn' in finding), JSON.stringify(finding));
    });

    for (const variant of fixtureVariants('delta-review-notification').filter((name) => name !== 'null-result')) {
      test(`the ${variant} deltaReview result validates without its blob SHAs`, () => {
        addDelta(fixture('delta-review-notification', variant, 'entity').result);
        const payload = homePayload();
        const delta = firstDelta(payload);
        assert.ok(!('old-git-blob-sha' in delta) && !('new-git-blob-sha' in delta), JSON.stringify(delta));
        assertPayloadClosed(payload, firstDelta);
      });
    }

    test('a delta for a new file (no old score) validates', () => {
      const delta: Delta = fixture('delta', 'full', 'entity');
      delete delta['old-score'];
      addDelta(delta);
      assert.ok(!('old-score' in firstDelta(homePayload())));
      validateWebviewPayload(homePayload());
    });

    test('no delta at all validates', () => {
      assert.deepStrictEqual(homePayload().data.fileDeltaData, []);
      assertPayloadClosed(homePayload(), (copy) => copy.data);
    });

    aceTest('a running and queued analysis with the ACE feature on validates', () => {
      enableAce();
      assert.strictEqual(homePayload().data.autoRefactor.visible, true);
      addDelta(fixture('delta', 'full', 'entity'));
      homeView['applyAnalysisEvent']({
        state: 'running',
        jobs: new Set([FILE]),
        queued: ['src/fake.js', 'src/other.js'],
        queueCount: 2,
        queueDone: 1,
      });
      const payload = homePayload();
      assert.strictEqual(payload.data.analysisState, 'running');
      assert.deepStrictEqual(
        payload.data.jobs.map((job: any) => job.state),
        ['running', 'queued']
      );
      assertPayloadClosed(payload, (copy) => copy.data.jobs[0]);
      assertPayloadClosed(payload, (copy) => copy.data.autoRefactor);
    });

    test('the signed-in auth payload rides along and validates', () => {
      setCwfAuth(toAuthPayload(signedInSnapshot()));
      addDelta(fixture('delta', 'full', 'entity'));
      const message = updateRendererMessage(homePayload());
      assert.deepStrictEqual((message.payload as any).featureFlags, ['ide-auth']);
      assertPayloadClosed(message.payload, (copy) => copy.auth.status);
    });
  });

  // ---- Docs data ----

  suite('docs data', () => {
    const reviewFixture = (variant: string): Review => fixture('review', variant, 'entity');

    /** The params the production code builds when the user opens docs for a code smell of the review. */
    function docsParams(variant: string, level: 'file' | 'function', document: vscode.TextDocument): InteractiveDocsParams {
      const review = reviewFixture(variant);
      const codeSmell =
        level === 'file'
          ? review['file-level-code-smells'][0]
          : review['function-level-code-smells'][0]['code-smells'][0];
      return toDocsParamsRanged('Complex Method', document, codeSmell, { reviewResult: review });
    }

    let documentCount = 0;
    const newDocument = () => new TestTextDocument(`${REPO}/src/docs-${++documentCount}.js`, '', 'javascript');

    const fileData = (copy: any) => copy.data.fileData;

    for (const variant of fixtureVariants('review')) {
      aceTest(`the ${variant} review fixture, function-level smell, refactorable, validates and is closed`, async () => {
        enableAce();
        const payload = await getDocsData(docsParams(variant, 'function', newDocument()));
        assert.strictEqual(payload.data.fileData?.fn?.name, 'fakeFunction');
        assertPayloadClosed(payload, fileData);
        assertPayloadClosed(payload, (copy) => copy.data.fileData.fn.range);
        assertPayloadClosed(updateRendererMessage(payload).payload, (copy) => copy.data);
        assert.deepStrictEqual(
          { visible: payload.data.autoRefactor?.visible, disabled: payload.data.autoRefactor?.disabled },
          { visible: true, disabled: false }
        );
        assertPayloadClosed(payload, (copy) => copy.data.autoRefactor);
      });

      test(`the ${variant} review fixture, file-level smell, validates and is closed`, async () => {
        const payload = await getDocsData(docsParams(variant, 'file', newDocument()));
        assertPayloadClosed(payload, fileData);
      });
    }

    test('the general Code Health docs, which carry no code smell, validate and are closed', async () => {
      // As codescene.openCodeHealthDocs builds them.
      const params: InteractiveDocsParams = {
        issueInfo: { category: 'docs_general_code_health', position: new vscode.Position(0, 0) },
        document: newDocument(),
      };
      const payload = await getDocsData(params);
      assert.strictEqual(payload.data.docType, 'docs_general_code_health');
      assertPayloadClosed(payload, (copy) => copy.data);
    });

    test('docs data with no document validates', async () => {
      const payload = await getDocsData({ issueInfo: { category: 'docs_general_code_health' } });
      assert.strictEqual(payload.data.fileData, undefined);
      assertPayloadClosed(payload, (copy) => copy.data);
    });

    test('the signed-in auth payload rides along and validates', async () => {
      setCwfAuth(toAuthPayload(signedInSnapshot()));
      const message = updateRendererMessage(await getDocsData(docsParams('full', 'function', newDocument())));
      assertPayloadClosed(message.payload, (copy) => copy.auth.status);
    });

    test('the docs panel posts valid data after the webview reports init', async () => {
      const panelClass = CodeSceneCWFDocsTabPanel as unknown as { _instance?: CodeSceneCWFDocsTabPanel };
      panelClass._instance?.dispose();
      const panel = CodeSceneCWFDocsTabPanel.instance as any;
      panel.state = docsParams('full', 'function', newDocument());
      try {
        await getWebviewMessageHandler()!({ messageType: 'init', payload: 'docs' });
        const posted = getWebviewPostMessageCalls() as Array<{ messageType: string; payload: unknown }>;
        assert.strictEqual(posted.length, 1);
        assert.strictEqual(posted[0].messageType, 'update-renderer');
        assertPayloadClosed(posted[0].payload, (copy) => copy.data);
      } finally {
        panelClass._instance?.dispose();
      }
    });
  });

  // ---- Auth payload ----

  /** The snapshot cs-ide's replies add up to, from the entity-form auth fixtures. */
  function authSnapshot(status: AuthStatus, variant: 'minimal' | 'full'): AuthSnapshot {
    if (variant === 'minimal') {
      return { ...INACTIVE_SNAPSHOT, active: true, status };
    }
    const accounts: Account[] = fixture('account-list', 'full', 'entity');
    const projects: Project[] = fixture('project-list', 'full', 'entity');
    const link = fixture('project-link', 'full', 'entity');
    return {
      ...INACTIVE_SNAPSHOT,
      active: true,
      status,
      accounts,
      projects,
      repo: { path: REPO, name: 'repo' },
      linkedProject: link.project,
      projectSource: link.source ?? null,
      projectReason: link.reason ?? null,
      projectCandidates: link.candidates ?? [],
    };
  }

  const signedInSnapshot = () => authSnapshot(fixture('auth-status', 'signed-in', 'entity'), 'full');

  suite('auth payload', () => {
    for (const statusVariant of fixtureVariants('auth-status')) {
      for (const inputs of ['minimal', 'full'] as const) {
        test(`the ${statusVariant} auth-status fixture with ${inputs} accounts and projects validates and is closed`, () => {
          const snapshot = authSnapshot(fixture('auth-status', statusVariant, 'entity'), inputs);
          setCwfAuth(toAuthPayload(snapshot), toAuthFlow(snapshot));

          // The auth view, and the home view (whose props the auth payload rides along with)
          const authView = updateRendererMessage(authViewProps()).payload as any;
          assert.deepStrictEqual(authView.featureFlags, ['ide-auth']);
          assertPayloadClosed(authView, (copy) => copy.auth.status.server);
          assertPayloadClosed(authView, (copy) => copy.auth);
          assertPayloadClosed(authView, (copy) => copy.authFlow);

          const props: HomeContextViewProps = { ideType: 'VSCode', view: 'home', data: { fileDeltaData: [] } };
          const homeProps = withCwfAuth(props);
          assertPayloadClosed(homeProps, (copy) => copy.auth.status);
          assertPayloadClosed(homeProps, (copy) => copy.authFlow);
        });
      }
    }

    test('an inactive sign-in puts no auth payload on the view', () => {
      setCwfAuth(toAuthPayload(INACTIVE_SNAPSHOT));
      const view = updateRendererMessage(authViewProps()).payload as any;
      assert.ok(!('auth' in view), JSON.stringify(view));
      validateWebviewPayload(view);
    });

    test('the auth surface hands the webview a valid payload with the auth flow, before and after a state change', () => {
      const signedIn = signedInSnapshot();
      setCwfAuth(toAuthPayload(signedIn), toAuthFlow(signedIn), 'auth');
      const first = updateRendererMessage(authViewProps()).payload as any;
      assertPayloadClosed(first, (copy) => copy.auth);
      assertPayloadClosed(first, (copy) => copy.authFlow);

      const signingIn = authSnapshot(fixture('auth-status', 'signing-in', 'entity'), 'minimal');
      setCwfAuth(toAuthPayload(signingIn), toAuthFlow(signingIn), 'auth');
      const second = updateRendererMessage(authViewProps()).payload as any;
      assertPayloadClosed(second, (copy) => copy.auth);
      assertPayloadClosed(second, (copy) => copy.authFlow);
    });
  });
});

// ---- Messages the extension receives ------------------------------------------------------------------------------

suite('Contract webview messages Test Suite', () => {
  const fn: FunctionInfoExternal = { name: 'fakeFunction', range: { startLine: 3, startColumn: 1, endLine: 9, endColumn: 2 } };
  const commands: Array<{ command: string; args: unknown[] }> = [];
  const shown: Array<{ document: vscode.TextDocument; selection?: any }> = [];
  const originalExecuteCommand = vscode.commands.executeCommand;
  const originalShowTextDocument = (vscode.window as any).showTextDocument;
  const configurationUpdates: Array<{ key: string; value: unknown }> = [];

  let mockContext: vscode.ExtensionContext;
  let homeView: HomeView;
  let document: TestTextDocument;

  setup(async () => {
    mockContext = createMockExtensionContext('/test/contract-webview-messages');
    CsExtensionState.init(mockContext);
    initExtensionId({ extension: { id: 'CodeScene.codescene-vscode' } } as vscode.ExtensionContext);
    commands.length = 0;
    shown.length = 0;
    configurationUpdates.length = 0;
    resetWebviewPanelMocks();

    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      commands.push({ command, args });
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;
    (vscode.window as any).showTextDocument = async (shownDocument: vscode.TextDocument) => {
      const editor: { selection?: any; revealRange: () => void } = { revealRange: () => {} };
      shown.push({ document: shownDocument, get selection() { return editor.selection; } });
      return editor;
    };
    (vscode.workspace as any).getConfiguration = () => ({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      has: () => true,
      inspect: () => ({}),
      update: (key: string, value: unknown) => {
        configurationUpdates.push({ key, value });
        return Promise.resolve();
      },
    });

    homeView = new HomeView(mockContext, { updateBadge: () => {}, dispose: () => {} } as unknown as BackgroundServiceView);
    document = new TestTextDocument(FILE, '', 'javascript');
    const delta: Delta = fixture('delta', 'full', 'entity');
    addRefactorableFunctions(fakeSource(), delta);
    homeView['updateFileDeltaData']({ document, result: delta, updateMonitor: true });
  });

  teardown(() => {
    vscode.commands.executeCommand = originalExecuteCommand;
    (vscode.window as any).showTextDocument = originalShowTextDocument;
    restoreDefaultConfiguration();
    resetWebviewPanelMocks();
    registerAuthMessages({} as AuthActions, {} as AuthMessageTarget).dispose();
  });

  const homeSamples = () => homeMessageSamples({ fileName: FILE, fn, docType: 'docs_issues_complex_method' });

  test('every sample validates against the message schema', () => {
    for (const message of [...homeSamples(), ...docsMessageSamples, ...authMessageSamples]) {
      validateWebviewMessage(message);
    }
  });

  test('the samples cover every auth message the handler routes', () => {
    const handled = [
      'open-auth',
      'auth-sign-in',
      'auth-open-browser-again',
      'auth-close',
      'auth-skip-project',
      'hide-sign-in-banner',
      'auth-sign-out',
      'auth-retry',
      'auth-select-account',
      'auth-link-project',
      'auth-set-access-token',
      'auth-remove-access-token',
      'auth-open-server-setting',
      'auth-open-pat-page',
    ];
    assert.deepStrictEqual([...new Set(authMessageSamples.map((message) => message.messageType))].sort(), handled.sort());
  });

  for (const sample of authMessageSamples) {
    test(`auth sample ${sample.messageType}${'payload' in sample ? ` ${JSON.stringify(sample.payload)}` : ''} is routed and closed`, async () => {
      const calls: unknown[][] = [];
      const record = (name: string) => async (...args: unknown[]) => {
        calls.push([name, ...args]);
      };
      const status = fixture('auth-status', 'signed-in', 'entity') as AuthStatus;
      const actions = {
        current: { ...INACTIVE_SNAPSHOT, active: true, status },
        signIn: record('signIn'),
        openBrowserAgain: record('openBrowserAgain'),
        openAuth: record('openAuth'),
        closeAuth: record('closeAuth'),
        skipProject: record('skipProject'),
        hideSignInBanner: record('hideSignInBanner'),
        signOut: record('signOut'),
        retry: record('retry'),
        selectAccount: record('selectAccount'),
        linkProject: record('linkProject'),
        setAccessToken: record('setAccessToken'),
        removeAccessToken: record('removeAccessToken'),
        reauthorize: record('reauthorize'),
      } as AuthActions;
      const target: AuthMessageTarget = {
        openServerSetting: record('openServerSetting'),
        openExternal: record('openExternal'),
      };
      registerAuthMessages(actions, target);

      assert.strictEqual(await routeAuthMessage(sample as MessageToIDEType), true);
      assert.strictEqual(calls.length, 1, `expected one action, got ${JSON.stringify(calls)}`);
      if ('payload' in sample) {
        // The handler reads the payload: its value reaches the action.
        assert.deepStrictEqual(calls[0].slice(1), [Object.values(sample.payload as object)[0]]);
      }
      if (sample.messageType === 'auth-open-pat-page') {
        assert.deepStrictEqual(calls[0], ['openExternal', status.server['pat-url']]);
      }
      assertValidAndClosed(sample, validateWebviewMessage, messagePayload);
    });
  }

  test('the home samples are handled by the home view handler', async () => {
    for (const message of homeSamples()) {
      commands.length = 0;
      shown.length = 0;
      configurationUpdates.length = 0;
      await handleCWFMessage(homeView, message);
      await flushPromises(); // the panel messages are handled without being awaited
      assertValidAndClosed(message, validateWebviewMessage, messagePayload);
      assertHomeEffect(message);
    }
  });

  function assertHomeEffect(message: MessageToIDEType): void {
    const label = `${message.messageType} ${JSON.stringify('payload' in message ? message.payload : {})}`;
    switch (message.messageType) {
      case 'init':
        assert.strictEqual(homeView['initialized'], true, label);
        break;
      case 'goto-function-location': {
        assert.strictEqual(shown.length, 1, label);
        assert.strictEqual(shown[0].document, document, label);
        const position = message.payload.fn?.range
          ? new vscode.Position(message.payload.fn.range.startLine - 1, message.payload.fn.range.startColumn - 1)
          : undefined;
        assert.deepStrictEqual(shown[0].selection?.active, position, label);
        break;
      }
      case 'open-settings':
        assert.deepStrictEqual(
          commands.map((c) => c.command),
          ['workbench.action.openWorkspaceSettings'],
          label
        );
        break;
      case 'open-docs-for-function': {
        assert.deepStrictEqual(
          commands.map((c) => c.command),
          ['codescene.openInteractiveDocsPanel'],
          label
        );
        const params = commands[0].args[0] as InteractiveDocsParams;
        assert.strictEqual(params.issueInfo.category, message.payload.docType, label);
        assert.strictEqual(params.document, document, label);
        assert.strictEqual(params.fnToRefactor?.name, 'fakeFunction', label);
        assert.deepStrictEqual(params.issueInfo.position, new vscode.Position(2, 0), label);
        break;
      }
      case 'request-and-present-refactoring': {
        assert.deepStrictEqual(
          commands.map((c) => c.command),
          ['codescene.requestAndPresentRefactoring'],
          label
        );
        assert.strictEqual((commands[0].args[2] as FnToRefactor).name, 'fakeFunction', label);
        break;
      }
      case 'stop-analysis':
        assert.deepStrictEqual(configurationUpdates.map((u) => u.value).slice(-1), [false], label);
        break;
      case 'start-analysis':
        assert.deepStrictEqual(configurationUpdates.map((u) => u.value).slice(-1), [true], label);
        break;
      default:
        assert.fail(`no expectation for ${label}`);
    }
  }

  test('a home message whose function the extension does not know is not mistaken for another', async () => {
    const message = { messageType: 'goto-function-location', payload: { fileName: `${REPO}/src/unknown.js`, fn } } as const;
    validateWebviewMessage(message);
    await handleCWFMessage(homeView, message);
    assert.deepStrictEqual(shown, []);
  });

  test('the docs samples are handled by the docs panel', async () => {
    const panelClass = CodeSceneCWFDocsTabPanel as unknown as { _instance?: CodeSceneCWFDocsTabPanel };
    panelClass._instance?.dispose();
    const panel = CodeSceneCWFDocsTabPanel.instance as any;
    panel.state = { issueInfo: { category: 'docs_general_code_health' }, document };
    try {
      const handler = getWebviewMessageHandler()!;
      for (const message of docsMessageSamples) {
        commands.length = 0;
        getWebviewPostMessageCalls().length = 0;
        await handler(message);
        assertValidAndClosed(message, validateWebviewMessage, messagePayload);
        if (message.messageType === 'init') {
          assert.strictEqual(panel.initialized, true);
          assert.strictEqual(getWebviewPostMessageCalls().length, 1);
        } else {
          assert.strictEqual(commands[0].command, 'workbench.action.openWorkspaceSettings');
        }
      }
    } finally {
      panelClass._instance?.dispose();
    }
  });

  test('a message the home view does not handle is reported, not routed', async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      await handleCWFMessage(homeView, { messageType: 'open-home' });
    } finally {
      console.warn = originalWarn;
    }
    assert.deepStrictEqual(warnings, [['open-home', 'not supported yet']]);
    assert.deepStrictEqual(commands, []);
  });
});
