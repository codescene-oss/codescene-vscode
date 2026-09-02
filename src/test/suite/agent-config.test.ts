import * as assert from 'assert';
import { buildAgentConfigWithToken } from '../../refactoring/agent-config';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';
import { aceSuite } from '../ace-test-suite';

const testCases = [
  {
    name: 'buildAgentConfigWithToken includes required fields',
    config: {},
    token: 'test-token-123',
    assertions: (result: any) => {
      assert.strictEqual(result.codescene_access_token, 'test-token-123');
      assert.deepStrictEqual(result.plugins, ['render-code-fix-reporter']);
      assert.ok(result.opencode_config, 'opencode_config should be present');
      assert.ok(result.opencode_config.provider['amazon-bedrock'], 'amazon-bedrock provider should be present');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.profile, 'codescene-dev');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.region, 'eu-west-1');
    },
  },
];

aceSuite('AgentConfig Test Suite', () => {
  teardown(() => {
    restoreDefaultConfiguration();
  });

  for (const tc of testCases) {
    test(tc.name, () => {
      mockConfiguration('codescene', tc.config);
      const result = buildAgentConfigWithToken(tc.token);
      tc.assertions(result);
    });
  }

  test('buildAgentConfigWithToken throws when token is empty', () => {
    mockConfiguration('codescene', {});
    assert.throws(() => buildAgentConfigWithToken(''), /No authentication token/);
  });
});
