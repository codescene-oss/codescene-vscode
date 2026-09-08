import * as assert from 'assert';
import { buildAgentConfigWithToken, buildOpencodeConfig } from '../../refactoring/agent-config';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';
import { aceSuite } from '../ace-test-suite';

const testCases = [
  {
    name: 'buildAgentConfigWithToken includes required fields without providerOptions',
    config: {},
    token: 'test-token-123',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.strictEqual(result.codescene_access_token, 'test-token-123');
      assert.deepStrictEqual(result.plugins, ['render-code-fix-reporter']);
      assert.deepStrictEqual(result.tracking, { environment: 'codescene-vscode' });
      assert.strictEqual(result.io_json_dir, undefined, 'io_json_dir should not be present when not provided');
      assert.strictEqual(result.opencode_config, undefined, 'opencode_config should not be present when no provider options');
    },
  },
  {
    name: 'buildAgentConfigWithToken includes io_json_dir when provided',
    config: {},
    token: 'test-token-456',
    ioDir: '/tmp/cs-agent-io-test',
    assertions: (result: any) => {
      assert.strictEqual(result.codescene_access_token, 'test-token-456');
      assert.deepStrictEqual(result.plugins, ['render-code-fix-reporter']);
      assert.strictEqual(result.io_json_dir, '/tmp/cs-agent-io-test', 'io_json_dir should match provided value');
    },
  },
  {
    name: 'buildAgentConfigWithToken builds opencode_config from providerOptions',
    config: {
      providerOptions: {
        'amazon-bedrock:profile': 'my-profile',
        'amazon-bedrock:region': 'us-east-1',
      },
    },
    token: 'test-token-789',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.ok(result.opencode_config, 'opencode_config should be present');
      assert.ok(result.opencode_config.provider['amazon-bedrock'], 'amazon-bedrock provider should be present');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.profile, 'my-profile');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.region, 'us-east-1');
    },
  },
  {
    name: 'buildAgentConfigWithToken handles partial providerOptions',
    config: {
      providerOptions: {
        'amazon-bedrock:profile': 'only-profile',
      },
    },
    token: 'test-token-partial',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.ok(result.opencode_config, 'opencode_config should be present');
      assert.ok(result.opencode_config.provider['amazon-bedrock'], 'amazon-bedrock provider should be present');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.profile, 'only-profile');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.region, undefined);
    },
  },
  {
    name: 'buildAgentConfigWithToken produces exact structure as previously hardcoded',
    config: {
      providerOptions: {
        'amazon-bedrock:profile': 'codescene-dev',
        'amazon-bedrock:region': 'eu-west-1',
      },
    },
    token: 'test-token-exact',
    ioDir: undefined,
    assertions: (result: any) => {
      const expectedOpencodeConfig = {
        provider: {
          'amazon-bedrock': {
            options: {
              profile: 'codescene-dev',
              region: 'eu-west-1',
            },
          },
        },
      };
      assert.deepStrictEqual(result.opencode_config, expectedOpencodeConfig);
    },
  },
  {
    name: 'buildAgentConfigWithToken builds opencode_config with Anthropic API key',
    config: {
      providerOptions: {
        'anthropic:api-key': 'sk-ant-test-key-123',
      },
    },
    token: 'test-token-anthropic',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.ok(result.opencode_config, 'opencode_config should be present');
      assert.strictEqual(result.opencode_config.provider.anthropic_api_key, 'sk-ant-test-key-123');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'], undefined);
    },
  },
  {
    name: 'buildAgentConfigWithToken builds opencode_config with OpenAI API key',
    config: {
      providerOptions: {
        'openai:api-key': 'sk-openai-test-key-456',
      },
    },
    token: 'test-token-openai',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.ok(result.opencode_config, 'opencode_config should be present');
      assert.strictEqual(result.opencode_config.provider.openai_api_key, 'sk-openai-test-key-456');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'], undefined);
    },
  },
  {
    name: 'buildAgentConfigWithToken builds opencode_config with Google API key',
    config: {
      providerOptions: {
        'google:api-key': 'google-test-key-789',
      },
    },
    token: 'test-token-google',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.ok(result.opencode_config, 'opencode_config should be present');
      assert.strictEqual(result.opencode_config.provider.google_api_key, 'google-test-key-789');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'], undefined);
    },
  },
  {
    name: 'buildAgentConfigWithToken combines multiple provider options',
    config: {
      providerOptions: {
        'amazon-bedrock:profile': 'my-profile',
        'anthropic:api-key': 'sk-ant-key',
        'openai:api-key': 'sk-openai-key',
        'google:api-key': 'google-key',
      },
    },
    token: 'test-token-multi',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.ok(result.opencode_config, 'opencode_config should be present');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.profile, 'my-profile');
      assert.strictEqual(result.opencode_config.provider.anthropic_api_key, 'sk-ant-key');
      assert.strictEqual(result.opencode_config.provider.openai_api_key, 'sk-openai-key');
      assert.strictEqual(result.opencode_config.provider.google_api_key, 'google-key');
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
      const result = buildAgentConfigWithToken(tc.token, tc.ioDir);
      tc.assertions(result);
    });
  }

  test('buildAgentConfigWithToken throws when token is empty', () => {
    mockConfiguration('codescene', {});
    assert.throws(() => buildAgentConfigWithToken(''), /No authentication token/);
  });

  test('buildOpencodeConfig produces exact structure as previously hardcoded', () => {
    const opts = {
      'amazon-bedrock:profile': 'codescene-dev',
      'amazon-bedrock:region': 'eu-west-1',
    };
    const result = buildOpencodeConfig(opts);
    const expected = {
      provider: {
        'amazon-bedrock': {
          options: {
            profile: 'codescene-dev',
            region: 'eu-west-1',
          },
        },
      },
    };
    assert.deepStrictEqual(result, expected);
  });

  test('buildOpencodeConfig returns undefined when no options', () => {
    assert.strictEqual(buildOpencodeConfig({}), undefined);
  });

  test('buildOpencodeConfig handles partial options', () => {
    const result = buildOpencodeConfig({ 'amazon-bedrock:region': 'us-west-2' });
    assert.deepStrictEqual(result, {
      provider: {
        'amazon-bedrock': {
          options: {
            region: 'us-west-2',
          },
        },
      },
    });
  });

  test('buildOpencodeConfig builds Anthropic provider config', () => {
    const result = buildOpencodeConfig({ 'anthropic:api-key': 'sk-ant-test-key' });
    assert.deepStrictEqual(result, {
      provider: {
        anthropic_api_key: 'sk-ant-test-key',
      },
    });
  });

  test('buildOpencodeConfig builds OpenAI provider config', () => {
    const result = buildOpencodeConfig({ 'openai:api-key': 'sk-openai-test-key' });
    assert.deepStrictEqual(result, {
      provider: {
        openai_api_key: 'sk-openai-test-key',
      },
    });
  });

  test('buildOpencodeConfig builds Google provider config', () => {
    const result = buildOpencodeConfig({ 'google:api-key': 'google-test-key' });
    assert.deepStrictEqual(result, {
      provider: {
        google_api_key: 'google-test-key',
      },
    });
  });

  test('buildOpencodeConfig combines all providers', () => {
    const result = buildOpencodeConfig({
      'amazon-bedrock:profile': 'dev-profile',
      'amazon-bedrock:region': 'eu-west-1',
      'anthropic:api-key': 'sk-ant-key',
      'openai:api-key': 'sk-openai-key',
      'google:api-key': 'google-key',
    });
    assert.deepStrictEqual(result, {
      provider: {
        'amazon-bedrock': {
          options: {
            profile: 'dev-profile',
            region: 'eu-west-1',
          },
        },
        anthropic_api_key: 'sk-ant-key',
        openai_api_key: 'sk-openai-key',
        google_api_key: 'google-key',
      },
    });
  });
});
