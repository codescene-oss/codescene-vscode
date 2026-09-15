import * as assert from 'assert';
import * as path from 'path';
import { AnalysisEvent, DevtoolsAPI } from '../../devtools-api';
import { CsIdeServerClient } from '../../devtools-api/ide-server-client';
import { aceTest } from '../ace-test-suite';
import { createMockExtensionContext } from '../mocks/mock-extension-context';

suite('DevtoolsAPI JSON-RPC Test Suite', () => {
  const fixture = path.join(__dirname, '../fixtures/ide-server-fixture.js');
  let client: CsIdeServerClient;

  setup(() => {
    client = new CsIdeServerClient(process.execPath, [fixture]);
    DevtoolsAPI.init(process.execPath, createMockExtensionContext(__dirname), client);
  });

  teardown(() => client.dispose());

  test('uses the shared server for migrated API operations', async () => {
    const event = {
      'editor-type': 'VSCode',
      'event-name': 'test',
      'extension-version': '1.0.0',
    };

    assert.strictEqual(await DevtoolsAPI.codeHealthRulesTemplate(), '{"rule_sets":[]}');
    assert.deepStrictEqual(await DevtoolsAPI.checkRules('/repo', 'src/file.ts'), { rulesMsg: 'matched' });
    assert.deepStrictEqual(await DevtoolsAPI.postTelemetry(event), { status: 202, params: { event } });
    assert.strictEqual(await DevtoolsAPI.getDeviceId(), 'device-42');
  });

  test('publishes queued analysis jobs from review queue progress', async () => {
    const events: AnalysisEvent[] = [];
    const subscription = DevtoolsAPI.onDidAnalysisStateChange((event) => events.push(event));
    const failure = new Promise<void>((resolve) => {
      client.onDidReviewFailed(() => resolve());
    });

    client.reviewFiles('/repo', [
      { id: 'file-1', relPath: 'file.ts', content: 'const x = 1;' },
      { id: 'file-2', relPath: 'broken.ts', content: 'fail' },
    ]);
    await failure;
    subscription.dispose();

    assert.ok(events.some((event) => event.state === 'running' && event.queueCount === 2));
    assert.ok(events.some((event) => event.state === 'idle' && event.queueCount === 0));
  });

  aceTest('uses the shared server for preflight', async () => {
    assert.strictEqual((await DevtoolsAPI.preflight())?.version, 2);
  });
});
