/* eslint-disable @typescript-eslint/naming-convention */
/**
 * D10 inbound replay over B1: every wire-form fixture of the CS IDE contract bundle that VS Code receives is
 * delivered by a stand-in server over real JSON-RPC stdio, so the production client and `src/auth` decode it.
 * The entity that comes out is serialized back to entity form, validated against its closed bundle schema and
 * compared with the entity-form fixture on the fields the model declares. An added, defaulted, dropped or
 * renamed field fails.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Event } from 'vscode';
import type { Account, AuthErrorCode, AuthStatus, Project, ProjectCandidate } from '../../centralized-webview-framework/types/auth';
import { AuthRpc, authErrorCode, isMethodNotFound, LoginStart, ProjectLink } from '../../auth/auth-rpc';
import { ChangeDetail, Delta, FunctionFinding, Function as DeltaFunction } from '../../devtools-api/delta-model';
import { CsIdeServerClient, DeltaResult, ReviewFailed, ReviewResult, ServerMetadata } from '../../devtools-api/ide-server-client';
import { CodeHealthRulesError, CodeSmell, Function as ReviewFunction, Range, Review } from '../../devtools-api/review-model';
import type {
  LocalFileResult,
  LocalResult,
  Objective,
  ObjectiveParent,
  ObjectiveProject,
  ObjectivesSnapshot,
  ObjectiveSubject,
  ObjectiveSubjectFile,
  ObjectiveThreshold,
  SharedResult,
} from '../../centralized-webview-framework/types/objectives';
import { ObjectivesRpc } from '../../objectives/objectives-rpc';
import {
  assertCasing,
  assertDeclaredFieldsMatch,
  assertRequiredFieldsDeclared,
  fixture,
  fixtureVariants,
  loadManifest,
  manifestEntry,
  schemaDefinition,
  SchemaRef,
  validate,
} from '../contract/contract';

// ---- What the models declare ---------------------------------------------------------------------------------
//
// Every key of a model type must be listed, so adding a field to a model forces a decision here: `true` compares
// the field with the fixture, a list names the declared fields of a nested object (needed for every nested object
// with required fields, so `assertRequiredFieldsDeclared` can see them), `false` marks a field that is not on
// the wire. Camel-case keys are compared in kebab-case, the form of the entity fixtures.

type Declaration<T> = { [K in keyof T]-?: boolean | string[] };

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function declared<T>(model: Declaration<T>): string[] {
  return Object.entries<boolean | string[]>(model).flatMap(([key, declaration]) => {
    if (declaration === true) return [kebab(key)];
    if (Array.isArray(declaration)) return declaration.map((field) => `${kebab(key)}.${field}`);
    return [];
  });
}

const range = declared<Range>({ 'start-line': true, 'start-column': true, 'end-line': true, 'end-column': true });
const codeSmell = declared<CodeSmell>({ category: true, details: true, 'highlight-range': range });
const reviewFields = declared<Review>({
  'file-level-code-smells': codeSmell,
  'function-level-code-smells': declared<ReviewFunction>({ function: true, range, 'code-smells': codeSmell }),
  'raw-score': true,
  score: true,
  'git-blob-sha': true,
  'code-health-rules-error': declared<CodeHealthRulesError>({ description: true, remedy: true }),
});

const changeDetail = declared<ChangeDetail>({ category: true, 'change-type': true, description: true, line: true });
const deltaFields = declared<Delta>({
  'file-level-findings': changeDetail,
  'function-level-findings': declared<FunctionFinding>({
    'change-details': changeDetail,
    function: declared<DeltaFunction>({ name: true, range }),
    refactorableFn: false, // attached by the extension after the fact, never received
  }),
  'score-change': true,
  'old-score': true,
  'new-score': true,
  'old-git-blob-sha': true,
  'new-git-blob-sha': true,
});

const fileReviewFields = declared<ReviewResult>({ id: true, path: true, repoRoot: true, result: reviewFields });
const deltaReviewFields = declared<DeltaResult>({ id: true, path: true, repoRoot: true, result: deltaFields });
const reviewFailedFields = declared<ReviewFailed>({ id: true, path: true, repoRoot: true, message: true, code: true });
const startFields = declared<ServerMetadata>({ sha: true, version: true, capabilities: true });

type Declared<T> = NonNullable<T>;
const authStatusFields = declared<AuthStatus>({
  state: true,
  'credential-source': true,
  'env-token-present': true,
  server: declared<AuthStatus['server']>({ url: true, onprem: true, source: true, 'pat-url': true }),
  'oauth-supported': true,
  user: declared<Declared<AuthStatus['user']>>({ id: true, name: true }),
  account: declared<Declared<AuthStatus['account']>>({ id: true, name: true }),
  license: declared<Declared<AuthStatus['license']>>({ pro: true, state: true }),
  'ace-credential': true,
  'expires-at': true,
  login: declared<Declared<AuthStatus['login']>>({ 'login-id': true, 'authorize-url': true }),
  error: declared<Declared<AuthStatus['error']>>({ code: true, message: true }),
});
const accountFields = declared<Account>({ id: true, name: true, 'signed-in-locally': true });
const projectFields = declared<Project>({ id: true, name: true });
const loginStartFields = declared<LoginStart>({ 'login-id': true, 'authorize-url': true });
const projectCandidateFields = declared<ProjectCandidate>({ id: true, name: true, 'account-id': true });
const projectLinkFields = declared<ProjectLink>({
  project: projectFields,
  source: true,
  reason: true,
  candidates: projectCandidateFields,
});
const objectivesSnapshotFields = declared<ObjectivesSnapshot>({
  'repo-root': true,
  state: true,
  project: declared<ObjectiveProject>({ id: true, name: true }),
  'refreshed-at': true,
  objectives: declared<Objective>({
    kind: true,
    id: true,
    revision: true,
    'area-id': true,
    'metric-id': true,
    threshold: declared<ObjectiveThreshold>({ operator: true, mode: true, value: true, 'comparison-value': true }),
    parent: declared<ObjectiveParent>({ kind: true, id: true }),
    subject: declared<ObjectiveSubject>({ type: true, files: declared<ObjectiveSubjectFile>({ path: true }) }),
    shared: declared<SharedResult>({ applicability: true, result: true, value: true, 'evaluated-at': true, 'as-of': true }),
    local: declared<LocalResult>({
      result: true,
      reason: true,
      files: declared<LocalFileResult>({ path: true, result: true, reason: true, value: true, 'comparison-value': true }),
    }),
  }),
});
// The error object of a JSON-RPC response as the client surfaces it; `data` is compared as a whole.
const jsonRpcErrorFields = ['code', 'message', 'data'];

// ---- Replay machinery ----------------------------------------------------------------------------------------

const replayServer = path.join(__dirname, '../fixtures/contract-replay-server.js');
const REPO = '/fake/repo';

let scratchDir: string;

function startFile(name: string, wireStart: unknown): string {
  const file = path.join(scratchDir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(wireStart));
  return file;
}

function replayClient(name: string, wireStart: unknown): CsIdeServerClient {
  return new CsIdeServerClient(process.execPath, [replayServer, startFile(name, wireStart)]);
}

function next<T>(event: Event<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const subscription = event((value) => {
      subscription.dispose();
      resolve(value);
    });
  });
}

/** The entity form of a notification the client re-shaped: its `repoRoot` is the wire's `repo-root`. */
function notificationEntity<T extends { repoRoot: string }>({ repoRoot, ...rest }: T): object {
  return { ...rest, 'repo-root': repoRoot };
}

/** What a rejected request carries, as the JSON-RPC error object it came from. */
function errorEntity(error: { code: number; message: string; data?: unknown }): object {
  return { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) };
}

interface ReplayContext {
  client: CsIdeServerClient;
  auth: AuthRpc;
  /** Have the server answer requests for `method` with the wire fixture as its result. */
  respond(method: string, result: unknown): Promise<unknown>;
  /** Have the server send the wire fixture as the params of a `method` notification. */
  notify(method: string, params: unknown): Promise<unknown>;
}

interface InboundCase {
  /** The wire manifest method. */
  method: string;
  /** Where the manifest names the schema: the result of a request, or the params of a notification. */
  side: 'result' | 'params';
  /** The fixture root in fixtures/index.json. */
  root: string;
  /** Feeds the wire fixture to production code and returns the entity it produced, in entity form. */
  replay(context: ReplayContext, wire: any): Promise<unknown>;
  declared: string[];
}

const entityOfRequest = (method: string, call: (context: ReplayContext) => Promise<unknown>) =>
  async (context: ReplayContext, wire: unknown) => {
    await context.respond(method, wire);
    return call(context);
  };

const entityOfNotification = <T>(method: string, event: (client: CsIdeServerClient) => Event<T>, entity: (value: T) => unknown) =>
  async (context: ReplayContext, wire: unknown) => {
    const received = next(event(context.client));
    await context.notify(method, wire);
    return entity(await received);
  };

const authStatusResult = (method: string, call: (rpc: AuthRpc) => Promise<AuthStatus>): InboundCase => ({
  method,
  side: 'result',
  root: 'auth-status',
  replay: entityOfRequest(method, ({ auth }) => call(auth)),
  declared: authStatusFields,
});

const cases: InboundCase[] = [
  {
    method: 'cs-ide/review',
    side: 'result',
    root: 'review',
    replay: entityOfRequest('cs-ide/review', ({ client }) => client.review({ path: 'src/fake.js' })),
    declared: reviewFields,
  },
  {
    method: 'cs-ide/delta',
    side: 'result',
    root: 'delta',
    replay: entityOfRequest('cs-ide/delta', ({ client }) => client.delta({})),
    declared: deltaFields,
  },
  {
    method: 'cs-ide/fileReview',
    side: 'params',
    root: 'file-review-notification',
    replay: entityOfNotification('cs-ide/fileReview', (client) => client.onDidReview, notificationEntity),
    declared: fileReviewFields,
  },
  {
    method: 'cs-ide/deltaReview',
    side: 'params',
    root: 'delta-review-notification',
    replay: entityOfNotification('cs-ide/deltaReview', (client) => client.onDidDelta, notificationEntity),
    declared: deltaReviewFields,
  },
  {
    method: 'cs-ide/reviewFailed',
    side: 'params',
    root: 'review-failed-notification',
    replay: entityOfNotification('cs-ide/reviewFailed', (client) => client.onDidReviewFailed, notificationEntity),
    declared: reviewFailedFields,
  },
  {
    method: 'cs-ide/objectives',
    side: 'result',
    root: 'objectives-snapshot',
    replay: entityOfRequest('cs-ide/objectives', ({ client }) => new ObjectivesRpc(client).snapshot(REPO)),
    declared: objectivesSnapshotFields,
  },
  {
    method: 'cs-ide/objectivesChanged',
    side: 'params',
    root: 'objectives-snapshot',
    replay: entityOfNotification('cs-ide/objectivesChanged', (client) => client.onDidObjectivesChange, (snapshot) => snapshot),
    declared: objectivesSnapshotFields,
  },
  authStatusResult('cs-ide/auth-status', (rpc) => rpc.status()),
  authStatusResult('cs-ide/auth-configure', (rpc) => rpc.configure({ 'server-url': null, 'access-token': null })),
  authStatusResult('cs-ide/auth-cancel-login', (rpc) => rpc.cancelLogin('fake-login-id')),
  authStatusResult('cs-ide/auth-logout', (rpc) => rpc.logout()),
  authStatusResult('cs-ide/auth-select-account', (rpc) => rpc.selectAccount('42')),
  authStatusResult('cs-ide/auth-sync-account', (rpc) => rpc.syncAccount(REPO)),
  {
    method: 'cs-ide/authStatusChanged',
    side: 'params',
    root: 'auth-status',
    replay: entityOfNotification('cs-ide/authStatusChanged', (client) => client.onDidAuthStatusChange, (status) => status),
    declared: authStatusFields,
  },
  {
    method: 'cs-ide/auth-login',
    side: 'result',
    root: 'login-pending',
    replay: entityOfRequest('cs-ide/auth-login', ({ auth }) => auth.login()),
    declared: loginStartFields,
  },
  {
    method: 'cs-ide/auth-list-accounts',
    side: 'result',
    root: 'account-list',
    replay: entityOfRequest('cs-ide/auth-list-accounts', ({ auth }) => auth.listAccounts()),
    declared: accountFields,
  },
  {
    method: 'cs-ide/projects-list',
    side: 'result',
    root: 'project-list',
    replay: entityOfRequest('cs-ide/projects-list', ({ auth }) => auth.listProjects()),
    declared: projectFields,
  },
  {
    method: 'cs-ide/project-link-get',
    side: 'result',
    root: 'project-link',
    replay: entityOfRequest('cs-ide/project-link-get', ({ auth }) => auth.getProjectLink(REPO)),
    declared: projectLinkFields,
  },
  {
    method: 'cs-ide/project-link-set',
    side: 'result',
    root: 'project-link',
    replay: entityOfRequest('cs-ide/project-link-set', ({ auth }) => auth.setProjectLink(REPO, '101')),
    declared: projectLinkFields,
  },
];

function schemaOf(method: string, side: 'result' | 'params'): SchemaRef {
  const ref = manifestEntry(method)[side];
  assert.ok(ref, `The wire manifest names no ${side} schema for ${method}`);
  return ref;
}

suite('Contract inbound replay Test Suite', () => {
  let context: ReplayContext;

  suiteSetup(async () => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-contract-inbound-'));
    const client = replayClient('start', fixture('start-notification', 'minimal', 'wire'));
    await client.start();
    context = {
      client,
      auth: new AuthRpc(client),
      respond: (method, result) => client.request('test/respond', { method, result }),
      notify: (method, params) => client.request('test/notify', { method, params }),
    };
  });

  suiteTeardown(() => {
    context.client.dispose();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  for (const inbound of cases) {
    suite(`${inbound.method} ${inbound.side}`, () => {
      for (const variant of fixtureVariants(inbound.root)) {
        test(`${variant}: validates against the bundle schema and keeps the declared fixture fields`, async () => {
          const ref = schemaOf(inbound.method, inbound.side);
          const wire = fixture(inbound.root, variant, 'wire');
          assertCasing(wire, ref.casing);

          const entity = JSON.parse(JSON.stringify(await inbound.replay(context, wire)));

          validate(ref.schema, ref.definition, entity);
          assertDeclaredFieldsMatch(fixture(inbound.root, variant, 'entity'), entity, inbound.declared);
        });
      }

      test('the model declares every field the schema requires', () => {
        const ref = schemaOf(inbound.method, inbound.side);
        assertRequiredFieldsDeclared(ref.schema, ref.definition, inbound.declared);
      });
    });
  }

  suite('cs-ide/start params', () => {
    for (const variant of fixtureVariants('start-notification')) {
      test(`${variant}: validates against the bundle schema and keeps the declared fixture fields`, async () => {
        const ref = schemaOf('cs-ide/start', 'params');
        const wire = fixture('start-notification', variant, 'wire');
        assertCasing(wire, ref.casing);
        const client = replayClient(`start-${variant}`, wire);
        try {
          const started = next(client.onDidServerStart);
          await client.start();
          const { metadata, restart } = await started;

          assert.strictEqual(restart, false);
          const entity = JSON.parse(JSON.stringify(metadata));
          validate(ref.schema, ref.definition, entity);
          assertDeclaredFieldsMatch(fixture('start-notification', variant, 'entity'), entity, startFields);
        } finally {
          client.dispose();
        }
      });
    }

    test('the model declares every field the schema requires', () => {
      const ref = schemaOf('cs-ide/start', 'params');
      assertRequiredFieldsDeclared(ref.schema, ref.definition, startFields);
    });
  });

  suite('cs-ide/delta null result', () => {
    test('the manifest allows it and the client returns null instead of a defaulted Delta', async () => {
      assert.strictEqual(schemaOf('cs-ide/delta', 'result').nullable, true);
      await context.respond('cs-ide/delta', null);
      assert.strictEqual(await context.client.delta({}), null);
    });
  });

  suite('JSON-RPC errors', () => {
    const errorRef = (): SchemaRef => {
      const entry = loadManifest().find((candidate) => candidate.kind === 'error');
      assert.ok(entry?.error, 'The wire manifest has no error entry');
      return entry.error;
    };

    async function rejectionOf(wire: { code: number; message: string; data?: unknown }): Promise<any> {
      await context.client.request('test/respond', { method: 'cs-ide/auth-status', error: wire });
      return context.auth.status().then(
        () => assert.fail('The request was expected to be rejected'),
        (error: unknown) => error
      );
    }

    for (const variant of fixtureVariants('json-rpc-error')) {
      test(`${variant}: the rejection validates against the bundle schema and keeps code, message and data`, async () => {
        const ref = errorRef();
        const wire = fixture('json-rpc-error', variant, 'wire');
        assertCasing(wire, ref.casing);

        const error = await rejectionOf(wire);
        const entity = JSON.parse(JSON.stringify(errorEntity(error)));

        validate(ref.schema, ref.definition, entity);
        assertDeclaredFieldsMatch(fixture('json-rpc-error', variant, 'entity'), entity, jsonRpcErrorFields);
      });
    }

    suite('auth error path', () => {
      const authVariants = fixtureVariants('json-rpc-error').filter((variant) => variant.startsWith('auth-'));

      for (const variant of authVariants) {
        test(`${variant}: authErrorCode returns the contract code`, async () => {
          const wire = fixture('json-rpc-error', variant, 'wire');
          const code: AuthErrorCode = wire.data.code;

          assert.strictEqual(authErrorCode(await rejectionOf(wire)), code);
        });
      }

      test('errors that are not auth errors have no auth error code', async () => {
        for (const variant of fixtureVariants('json-rpc-error').filter((name) => !name.startsWith('auth-'))) {
          const rejection = await rejectionOf(fixture('json-rpc-error', variant, 'wire'));
          assert.strictEqual(authErrorCode(rejection), undefined, variant);
          assert.strictEqual(isMethodNotFound(rejection), variant === 'method-not-found', variant);
        }
      });

      test('the AuthErrorCode type and the fixtures cover exactly the codes of the schema', () => {
        const typeCodes: Record<AuthErrorCode, true> = {
          'auth/not-signed-in': true,
          'auth/oauth-unsupported': true,
          'auth/timeout': true,
          'auth/cancelled': true,
          'auth/port-unavailable': true,
          'auth/network': true,
          'auth/session-revoked': true,
          'auth/invalid-token': true,
          'auth/license-required': true,
        };
        const schemaCodes: string[] = schemaDefinition('wire.json', 'AuthErrorCode').enum;
        const fixtureCodes = authVariants.map((variant) => fixture('json-rpc-error', variant, 'wire').data.code);

        assert.deepStrictEqual(Object.keys(typeCodes).sort(), [...schemaCodes].sort());
        assert.deepStrictEqual([...fixtureCodes].sort(), [...schemaCodes].sort());
      });
    });
  });
});
