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
      assert.ok(result.opencode_config);
      assert.ok(result.opencode_config.model);
    },
  },
  {
    name: 'buildAgentConfigWithToken uses default model when not configured',
    config: {},
    token: 'test-token',
    assertions: (result: any) => {
      assert.strictEqual(result.opencode_config.model, 'amazon-bedrock/eu.anthropic.claude-sonnet-4-6');
    },
  },
  {
    name: 'buildAgentConfigWithToken uses configured model',
    config: { agentModel: 'anthropic/claude-3-opus' },
    token: 'test-token',
    assertions: (result: any) => {
      assert.strictEqual(result.opencode_config.model, 'anthropic/claude-3-opus');
    },
  },
  {
    name: 'buildAgentConfigWithToken includes AWS config for Bedrock models',
    config: {
      agentModel: 'amazon-bedrock/some-model',
      awsProfile: 'my-profile',
      awsRegion: 'us-east-1',
    },
    token: 'test-token',
    assertions: (result: any) => {
      assert.strictEqual(result.opencode_config.aws_profile, 'my-profile');
      assert.strictEqual(result.opencode_config.aws_region, 'us-east-1');
    },
  },
  {
    name: 'buildAgentConfigWithToken omits AWS profile when empty',
    config: {
      agentModel: 'amazon-bedrock/some-model',
      awsProfile: '',
      awsRegion: 'eu-west-1',
    },
    token: 'test-token',
    assertions: (result: any) => {
      assert.strictEqual(result.opencode_config.aws_profile, undefined);
      assert.strictEqual(result.opencode_config.aws_region, 'eu-west-1');
    },
  },
  {
    name: 'buildAgentConfigWithToken does not include AWS config for non-Bedrock models',
    config: {
      agentModel: 'anthropic/claude-3-opus',
      awsProfile: 'my-profile',
      awsRegion: 'us-east-1',
    },
    token: 'test-token',
    assertions: (result: any) => {
      assert.strictEqual(result.opencode_config.aws_profile, undefined);
      assert.strictEqual(result.opencode_config.aws_region, undefined);
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
