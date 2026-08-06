import * as assert from 'assert';
import * as path from 'path';
import { DevtoolsAPI } from '../../devtools-api';
import { CsIdeServerClient } from '../../devtools-api/ide-server-client';
import { createMockExtensionContext } from '../mocks/mock-extension-context';

suite('DevtoolsAPI JSON-RPC Test Suite', () => {
  const fixture = path.join(__dirname, '../fixtures/ide-server-fixture.js');
  let client: CsIdeServerClient;

  setup(() => {
    client = new CsIdeServerClient(process.execPath, [fixture]);
    DevtoolsAPI.init(process.execPath, createMockExtensionContext(__dirname), async () => false, client);
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
    assert.strictEqual((await DevtoolsAPI.preflight())?.version, 2);
    assert.deepStrictEqual(await DevtoolsAPI.postTelemetry(event), { status: 202, params: { event } });
    assert.strictEqual(await DevtoolsAPI.getDeviceId(), 'device-42');
  });
});
