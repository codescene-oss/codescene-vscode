import * as assert from 'assert';
import * as path from 'path';
import { CsIdeServerClient } from '../../devtools-api/ide-server-client';
import { gitBlobSha } from '../../review/review-pipeline';

suite('CsIdeServerClient Test Suite', () => {
  const fixture = path.join(__dirname, '../fixtures/ide-server-fixture.js');
  let client: CsIdeServerClient;

  setup(() => {
    client = new CsIdeServerClient(process.execPath, [fixture]);
  });

  teardown(() => client.dispose());

  test('reports startup metadata', async () => {
    assert.deepStrictEqual(await client.start(), { sha: 'fixture-sha', version: 'fixture-version', args: [] });
  });

  test('passes configured worker arguments to the server process', async () => {
    client.dispose();
    client = new CsIdeServerClient(process.execPath, [fixture, 'server', '--threads', '3']);
    assert.deepStrictEqual(await client.start(), {
      sha: 'fixture-sha',
      version: 'fixture-version',
      args: ['server', '--threads', '3'],
    });
  });

  test('sends typed requests over one connection', async () => {
    const codeSmells = {
      'file-name': 'file.ts',
      'file-content': 'function f() {}',
      preflight: { version: 2, 'file-types': ['ts'], 'language-common': { 'max-input-loc': 100, 'code-smells': [] } },
      'code-smells': [{ category: 'Complex Method' }],
    };
    const telemetry = {
      'editor-type': 'VSCode',
      'event-name': 'test',
      'extension-version': '1.0.0',
    };

    assert.deepStrictEqual(await client.review({ path: 'file.ts' }), {
      'file-level-code-smells': [],
      'function-level-code-smells': [],
      'raw-score': 'raw',
      score: 9.68,
      'git-blob-sha': 'review-sha',
    });
    assert.deepStrictEqual(await client.delta({ 'old-score': 'old' }), {
      'file-level-findings': [],
      'function-level-findings': [],
      'old-score': 10,
      'new-score': 9.68,
      'score-change': -0.32,
      'old-git-blob-sha': 'old-sha',
      'new-git-blob-sha': 'new-sha',
    });
    assert.deepStrictEqual(await client.preflight({ force: true }), {
      version: 2,
      'file-types': ['ts'],
      'language-common': { 'max-input-loc': 100, 'code-smells': ['Complex Method'] },
    });
    const [fn] = await client.fnsToRefactor(codeSmells);
    assert.strictEqual(fn['file-type'], 'TypeScript');
    assert.strictEqual(fn['function-type'], 'Function');
    assert.strictEqual(fn['nippy-b64'], 'encoded');
    assert.deepStrictEqual(fn.range, { 'start-line': 1, 'start-column': 1, 'end-line': 1, 'end-column': 16 });
    assert.deepStrictEqual(fn['refactoring-targets'], [{ category: 'Complex Method', line: 1 }]);
    const refactor = await client.refactor({ token: 'token' });
    assert.strictEqual(refactor['trace-id'], 'trace-1');
    assert.deepStrictEqual(refactor['credits-info'], { limit: 10, used: 1 });
    assert.deepStrictEqual(refactor['refactoring-properties'], { 'added-code-smells': [], 'removed-code-smells': ['Complex Method'] });
    assert.deepStrictEqual(refactor.confidence['recommended-action'], { description: 'Apply', details: 'Safe change' });
    assert.deepStrictEqual(await client.telemetry(telemetry), { status: 202, params: { event: telemetry } });
    assert.deepStrictEqual(await client.deviceId(), { 'device-id': 'device-42' });
    assert.deepStrictEqual(await client.codeHealthRulesTemplate(), { template: '{"rule_sets":[]}' });
    assert.deepStrictEqual(await client.checkRules('/repo', 'src/file.ts'), {
      result: 'matched',
      failed: false,
      'parsing-errors': [],
    });
  });

  test('receives correlated review, delta, and failure notifications', async () => {
    const review = new Promise<{ id: string; sha: string | undefined }>((resolve) => {
      client.onDidReview((event) => resolve({ id: event.id, sha: event.result['git-blob-sha'] }));
    });
    const delta = new Promise<{ id: string; score: number | undefined }>((resolve) => {
      client.onDidDelta((event) => resolve({ id: event.id, score: event.result?.['new-score'] }));
    });
    const failure = new Promise<{ id: string; message: string }>((resolve) => {
      client.onDidReviewFailed((event) => resolve({ id: event.id, message: event.message }));
    });

    client.reviewFiles('/repo', [
      { id: 'file-1', relPath: 'file.ts', content: 'const x = 1;' },
      { id: 'file-2', relPath: 'broken.ts', content: 'fail' },
    ]);

    assert.deepStrictEqual(await review, { id: 'file-1', sha: gitBlobSha('const x = 1;') });
    assert.deepStrictEqual(await delta, { id: 'file-1', score: 9.68 });
    assert.deepStrictEqual(await failure, { id: 'file-2', message: 'fixture review failed' });
  });

  test('rejects an in-flight request when the server exits', async () => {
    const connection = client as unknown as { sendRequest<T>(method: string, params: unknown): Promise<T> };
    await assert.rejects(connection.sendRequest('test/exit', {}), /exited|connection/i);
  });

  test('rejects startup when the process cannot be spawned', async () => {
    client.dispose();
    client = new CsIdeServerClient(path.join(__dirname, 'missing-server'));
    await assert.rejects(client.start(), /ENOENT|spawn/i);
  });

  test('can restart after the server exits', async () => {
    await client.start();
    const connection = client as unknown as { sendRequest<T>(method: string, params: unknown): Promise<T> };
    await assert.rejects(connection.sendRequest('test/exit', {}), /exited|connection/i);
    assert.deepStrictEqual(await client.restart(), { sha: 'fixture-sha', version: 'fixture-version', args: [] });
    assert.deepStrictEqual(await client.deviceId(), { 'device-id': 'device-42' });
  });
});
