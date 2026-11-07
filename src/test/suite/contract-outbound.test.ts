/* eslint-disable @typescript-eslint/naming-convention */
/**
 * D10 outbound: every schematized message VS Code sends is captured on the wire, by a stand-in cs-ide server
 * that records what the production client wrote to stdio, and validated against its params schema in the
 * contract bundle. The params must pass the closed schema and have kebab-case keys at every depth.
 *
 * Each message is built from the production call site with every input present and with every optional input
 * missing, in the shapes that call site produces. A message with no optional input has one variant.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import { AuthRpc } from '../../auth/auth-rpc';
import { ObjectivesRpc } from '../../objectives/objectives-rpc';
import { authConfiguration } from '../../auth/auth-settings';
import { CsExtensionState } from '../../cs-extension-state';
import { DevtoolsAPI } from '../../devtools-api';
import { CsIdeServerClient } from '../../devtools-api/ide-server-client';
import { ReviewPipeline, ReviewPipelinePresentation } from '../../review/review-pipeline';
import Telemetry from '../../telemetry';
import { assertCasing, fixture, loadManifest, manifestEntry, validate } from '../contract/contract';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { TestTextDocument } from '../mocks/test-text-document';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';

const replayServer = path.join(__dirname, '../fixtures/contract-replay-server.js');
const REPO = '/fake/repo';
const CAPTURE_TIMEOUT_MS = 5000;

interface Captured {
  kind: 'request' | 'notification';
  method: string;
  params: unknown;
}

/** The ways one production call site builds a message: variant name -> the call. */
type Variants = Record<string, () => unknown>;

/** Messages in the manifest that VS Code does not send; the coverage test names why. */
const notSentByVsCode: Record<string, string> = {
  'cs-ide/auth': 'license check: VS Code resolves its license through auth-status',
  'cs-ide/auth-token': 'the access token stays inside cs-ide; VS Code never asks for it',
  'cs-ide/features': 'VS Code does not probe feature availability; the objectives snapshot carries its own off state',
  'cs-ide/auth-reauthorize': 'tested in Task 3 (CS-12138)',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('Contract outbound params Test Suite', () => {
  let scratchDir: string;
  let client: CsIdeServerClient;
  let auth: AuthRpc;

  /** Runs `act` and returns the params of the one `method` message the server received because of it. */
  async function capture(method: string, act: () => unknown): Promise<unknown> {
    await client.request('test/captured', {});
    await act();
    const received: Captured[] = [];
    const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
    for (;;) {
      received.push(...(await client.request<Captured[]>('test/captured', {})));
      const matches = received.filter((message) => message.method === method);
      if (matches.length > 0) {
        assert.strictEqual(matches.length, 1, `Expected one ${method} message, got ${matches.length}`);
        return matches[0].params;
      }
      if (Date.now() > deadline) {
        assert.fail(`The server received no ${method} message; it received: ${received.map((m) => m.method).join(', ') || 'nothing'}`);
      }
      await sleep(10);
    }
  }

  const respond = (method: string, result: unknown) => client.request('test/respond', { method, result });

  // ---- Telemetry: the production Telemetry class on top of the real client -----------------------------------

  const extension = { id: 'codescene.codescene-vscode', packageJSON: { version: '1.2.3' } };
  let originalCreateTelemetryLogger: unknown;
  let originalStateProperties: PropertyDescriptor | undefined;

  function installTelemetry(): Telemetry {
    const env = vscode.env as any;
    originalCreateTelemetryLogger = env.createTelemetryLogger;
    // What VS Code's TelemetryLogger does: hand the event to the extension's sender under the extension id.
    env.createTelemetryLogger = (sender: vscode.TelemetrySender) => ({
      logUsage: (name: string, data?: Record<string, any>) => sender.sendEventData(`${extension.id}/${name}`, data),
      logError: () => {},
      dispose: () => {},
    });
    const telemetry = new Telemetry(extension as any);
    (Telemetry as any)._instance = telemetry;
    (Telemetry as any).sentErrorsCount = 0;
    return telemetry;
  }

  /** The state the extension is in when it sends an event: with or without a signed-in user and the internal flag. The editor version is always there. */
  function telemetryEnvironment(state: { userId?: string; internal: boolean }, act: () => unknown): () => unknown {
    return () => {
      Object.defineProperty(CsExtensionState, 'stateProperties', {
        get: () => ({
          auth: {
            active: true,
            status: state.userId ? { ...authStatusFixture('signed-in-oauth'), user: { id: state.userId, name: 'Test User' } } : null,
          },
          features: { analysis: { state: 'enabled' }, ace: { state: 'enabled' } },
        }),
        configurable: true,
      });
      if (state.internal) process.env.X_CODESCENE_INTERNAL = '1';
      else delete process.env.X_CODESCENE_INTERNAL;
      return act();
    };
  }

  const everyTelemetryInput = { userId: '4711', internal: true };
  const noTelemetryInput = { internal: false };

  // Event properties as the extension's call sites hand them to Telemetry.logUsage / logError.
  const telemetryCallSites: Variants = {
    'all inputs: user id, internal and call-site data': telemetryEnvironment(everyTelemetryInput, () =>
      Telemetry.logUsage('code-health-monitor/file-updated', { visible: true, scoreChange: -1.5, nIssues: 3 })
    ),
    'optional inputs missing: no user id, not internal, no data': telemetryEnvironment(noTelemetryInput, () =>
      Telemetry.logUsage('on_activate_extension')
    ),
    'call site: activation error': telemetryEnvironment(noTelemetryInput, () =>
      Telemetry.logUsage('on_activate_extension_error', { errorMessage: 'activation failed' })
    ),
    'call site: refactoring request': telemetryEnvironment(noTelemetryInput, () =>
      Telemetry.logUsage('refactor/requested', { source: 'codelens', traceId: 'trace-1', skipCache: true })
    ),
    'call site: sign-in failure': telemetryEnvironment(noTelemetryInput, () =>
      Telemetry.logUsage('auth/sign-in-failed', { 'error-code': 'auth/timeout' })
    ),
    'call site: unhandled error with nested extra data': telemetryEnvironment(noTelemetryInput, () => {
      const error = new Error('boom') as Error & { code: string };
      error.code = 'ECONNREFUSED';
      Telemetry.logError(error, true, { repoRoot: REPO, context: { fileName: 'a.ts', retryCount: [1, 2] } });
    }),
  };

  // ---- Review requests and notifications ----------------------------------------------------------------------

  const presentation: ReviewPipelinePresentation = {
    reviewStarted: () => undefined,
    reviewFinished: () => undefined,
    deltaStarted: () => undefined,
    deltaFinished: () => undefined,
    presentReview: () => undefined,
    presentDelta: () => undefined,
    remove: () => undefined,
    failed: () => undefined,
  };

  /** Submits through the production pipeline; the review itself never completes, so the pipeline is disposed after. */
  const submitThroughPipeline = (submission: Parameters<ReviewPipeline['submitBatch']>[1][number]) => () => {
    const pipeline = new ReviewPipeline(client, presentation, () => 'review-1');
    try {
      pipeline.submitBatch(REPO, [submission]).catch(() => undefined);
    } finally {
      pipeline.dispose();
    }
  };

  const cases: Array<{ method: string; variants: Variants }> = [
    {
      method: 'cs-ide/review',
      variants: {
        'all inputs': () => client.review({ path: 'src/file.ts', 'file-content': 'const a = 1;', 'cache-path': '/cache' }),
        'optional inputs missing': () => client.review({ path: 'src/file.ts' }),
      },
    },
    {
      method: 'cs-ide/delta',
      variants: {
        'all inputs': () => client.delta({ 'old-score': 'b2xkLXNjb3Jl', 'new-score': 'bmV3LXNjb3Jl' }),
        'optional inputs missing': () => client.delta({}),
        'new file: no old score': () => client.delta({ 'new-score': 'bmV3LXNjb3Jl' }),
        'deleted file: no new score': () => client.delta({ 'old-score': 'b2xkLXNjb3Jl' }),
      },
    },
    { method: 'cs-ide/telemetry', variants: telemetryCallSites },
    {
      method: 'cs-ide/reviewFiles',
      variants: {
        'all inputs: an unsaved buffer with id and content': submitThroughPipeline({
          document: new TestTextDocument(`${REPO}/src/file.ts`, 'const a = 1;', 'typescript'),
          relPath: 'src/file.ts',
          content: 'const a = 1;',
          updateDiagnosticsPane: true,
          updateMonitor: true,
        }),
        'optional inputs missing: a file read from disk': submitThroughPipeline({
          relPath: 'src/file.ts',
          updateDiagnosticsPane: false,
          updateMonitor: true,
        }),
      },
    },
    {
      method: 'cs-ide/watchFiles',
      variants: {
        'all inputs': () => client.watchFiles(REPO, ['src', 'lib']),
        'optional inputs missing': () => client.watchFiles(REPO),
      },
    },
    {
      method: 'cs-ide/stopWatchFiles',
      variants: {
        'all inputs': () => client.stopWatchFiles(REPO, ['src', 'lib']),
        'optional inputs missing': () => client.stopWatchFiles(REPO),
      },
    },

    // ---- src/auth/auth-rpc.ts ---------------------------------------------------------------------------------
    {
      method: 'cs-ide/auth-configure',
      variants: {
        'all inputs': () =>
          auth.configure(authConfiguration({ signInEnabled: true, serverUrl: 'https://codescene.example.com', accessToken: 'pat-123' })),
        'optional inputs missing: blank settings': () =>
          auth.configure(authConfiguration({ signInEnabled: true, serverUrl: '  ', accessToken: '' })),
      },
    },
    { method: 'cs-ide/auth-status', variants: { 'no inputs': () => auth.status() } },
    { method: 'cs-ide/auth-login', variants: { 'no inputs': () => auth.login() } },
    { method: 'cs-ide/auth-cancel-login', variants: { 'all inputs': () => auth.cancelLogin('login-1') } },
    { method: 'cs-ide/auth-logout', variants: { 'no inputs': () => auth.logout() } },
    { method: 'cs-ide/auth-list-accounts', variants: { 'no inputs': () => auth.listAccounts() } },
    { method: 'cs-ide/auth-select-account', variants: { 'all inputs': () => auth.selectAccount('42') } },
    { method: 'cs-ide/auth-sync-account', variants: { 'all inputs': () => auth.syncAccount(REPO) } },
    { method: 'cs-ide/projects-list', variants: { 'no inputs': () => auth.listProjects() } },
    { method: 'cs-ide/project-link-get', variants: { 'all inputs': () => auth.getProjectLink(REPO) } },
    {
      method: 'cs-ide/objectives',
      variants: {
        'all inputs': () => new ObjectivesRpc(client).snapshot(REPO, true),
        'optional inputs missing': () => new ObjectivesRpc(client).snapshot(REPO),
      },
    },
    {
      method: 'cs-ide/goalWorkSessionStart',
      variants: {
        'all inputs': () => {
          const { GoalWorkSessionRpc } = require('../../objectives/goal-work-session-rpc');
          return new GoalWorkSessionRpc(client).start(REPO, 123);
        },
      },
    },
    {
      method: 'cs-ide/project-link-set',
      variants: {
        'all inputs: link a project': () => auth.setProjectLink(REPO, '101'),
        'optional inputs missing: remove the link': () => auth.setProjectLink(REPO, null),
      },
    },
  ];

  suiteSetup(async () => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-contract-outbound-'));
    const startFile = path.join(scratchDir, 'start.json');
    fs.writeFileSync(startFile, JSON.stringify(fixture('start-notification', 'minimal', 'wire')));
    client = new CsIdeServerClient(process.execPath, [replayServer, startFile]);
    await client.start();
    auth = new AuthRpc(client);
    DevtoolsAPI.init(process.execPath, createMockExtensionContext(scratchDir), client);

    // Requests are answered with whatever the caller can decode; only what was sent matters here.
    await respond('cs-ide/review', fixture('review', 'minimal', 'wire'));
    await respond('cs-ide/telemetry', { status: 200 });
    for (const { method } of cases) {
      if (manifestEntry(method).kind === 'request' && !['cs-ide/review', 'cs-ide/telemetry'].includes(method)) {
        await respond(method, null);
      }
    }

    originalStateProperties = Object.getOwnPropertyDescriptor(CsExtensionState, 'stateProperties');
    mockConfiguration('codescene', { enableTelemetry: true });
    installTelemetry();
  });

  suiteTeardown(() => {
    (Telemetry as any)._instance = undefined;
    (vscode.env as any).createTelemetryLogger = originalCreateTelemetryLogger;
    delete process.env.X_CODESCENE_INTERNAL;
    if (originalStateProperties) Object.defineProperty(CsExtensionState, 'stateProperties', originalStateProperties);
    restoreDefaultConfiguration();
    client.dispose();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  for (const { method, variants } of cases) {
    suite(method, () => {
      for (const [variant, send] of Object.entries(variants)) {
        test(`${variant}: params validate against the bundle schema with kebab-case keys`, async () => {
          const ref = manifestEntry(method).params;
          assert.ok(ref, `The wire manifest names no params schema for ${method}`);
          assert.strictEqual(ref.casing, 'kebab', `${method} params are expected in kebab-case`);

          const params = JSON.parse(JSON.stringify(await capture(method, send)));

          assertCasing(params, 'kebab');
          validate(ref.schema, ref.definition, params);
        });
      }
    });
  }

  suite('coverage', () => {
    test('every schematized request and inbound notification of the manifest is either tested or named as not sent by VS Code', () => {
      const tested = new Set(cases.map(({ method }) => method));
      const outbound = loadManifest().filter(
        (entry) => entry.status === 'schematized' && (entry.kind === 'request' || entry.kind === 'notification-in')
      );

      const unaccounted = outbound.filter((entry) => !tested.has(entry.method!) && !(entry.method! in notSentByVsCode));
      assert.deepStrictEqual(
        unaccounted.map((entry) => entry.method),
        [],
        'These manifest messages are neither covered by an outbound case nor listed in notSentByVsCode'
      );

      const stale = [...tested, ...Object.keys(notSentByVsCode)].filter((method) => !outbound.some((entry) => entry.method === method));
      assert.deepStrictEqual(stale, [], 'These methods are not schematized outbound messages of the manifest');
      assert.deepStrictEqual(
        Object.keys(notSentByVsCode).filter((method) => tested.has(method)),
        [],
        'A method is both tested and listed as not sent'
      );
    });

    test('a camel-case key sent straight to the client is caught on the wire (the kebab check can fail)', async () => {
      await assert.rejects(
        capture('cs-ide/telemetry', () =>
          DevtoolsAPI.postTelemetry({ 'event-name': 'x', 'editor-type': 'vscode', 'extension-version': '1', scoreChange: 1 })
        ).then((params) => assertCasing(params, 'kebab')),
        /Keys not in kebab-case: \$\.event\.scoreChange/
      );
    });
  });
});
