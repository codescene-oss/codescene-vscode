import * as assert from 'assert';
import {
  buildAgentConfigWithToken,
  buildOpencodeConfig,
  buildProviderCredentials,
} from '../../refactoring/agent-config';
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
      assert.strictEqual(result.provider, undefined, 'provider should not be present when no API keys');
      assert.strictEqual(result.opencode_config, undefined, 'opencode_config should not be present when no bedrock options');
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
    name: 'buildAgentConfigWithToken builds opencode_config from bedrock providerOptions',
    config: {
      providerOptions: {
        'amazon-bedrock:profile': 'my-profile',
        'amazon-bedrock:region': 'us-east-1',
      },
    },
    token: 'test-token-789',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.strictEqual(result.provider, undefined, 'provider should not be present when no API keys');
      assert.ok(result.opencode_config, 'opencode_config should be present');
      assert.ok(result.opencode_config.provider['amazon-bedrock'], 'amazon-bedrock provider should be present');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.profile, 'my-profile');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.region, 'us-east-1');
    },
  },
  {
    name: 'buildAgentConfigWithToken handles partial bedrock providerOptions',
    config: {
      providerOptions: {
        'amazon-bedrock:profile': 'only-profile',
      },
    },
    token: 'test-token-partial',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.strictEqual(result.provider, undefined, 'provider should not be present when no API keys');
      assert.ok(result.opencode_config, 'opencode_config should be present');
      assert.ok(result.opencode_config.provider['amazon-bedrock'], 'amazon-bedrock provider should be present');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.profile, 'only-profile');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.region, undefined);
    },
  },
  {
    name: 'buildAgentConfigWithToken produces exact bedrock structure',
    config: {
      providerOptions: {
        'amazon-bedrock:profile': 'codescene-dev',
        'amazon-bedrock:region': 'eu-west-1',
      },
    },
    token: 'test-token-exact',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.strictEqual(result.provider, undefined, 'provider should not be present when no API keys');
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
    name: 'buildAgentConfigWithToken builds provider with Anthropic API key',
    config: {
      providerOptions: {
        'anthropic:api-key': 'sk-ant-test-key-123',
      },
    },
    token: 'test-token-anthropic',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.ok(result.provider, 'provider should be present');
      assert.strictEqual(result.provider.anthropic_api_key, 'sk-ant-test-key-123');
      assert.strictEqual(result.opencode_config, undefined, 'opencode_config should not be present when no bedrock options');
    },
  },
  {
    name: 'buildAgentConfigWithToken builds provider with OpenAI API key',
    config: {
      providerOptions: {
        'openai:api-key': 'sk-openai-test-key-456',
      },
    },
    token: 'test-token-openai',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.ok(result.provider, 'provider should be present');
      assert.strictEqual(result.provider.openai_api_key, 'sk-openai-test-key-456');
      assert.strictEqual(result.opencode_config, undefined, 'opencode_config should not be present when no bedrock options');
    },
  },
  {
    name: 'buildAgentConfigWithToken builds provider with Google API key',
    config: {
      providerOptions: {
        'google:api-key': 'google-test-key-789',
      },
    },
    token: 'test-token-google',
    ioDir: undefined,
    assertions: (result: any) => {
      assert.ok(result.provider, 'provider should be present');
      assert.strictEqual(result.provider.google_api_key, 'google-test-key-789');
      assert.strictEqual(result.opencode_config, undefined, 'opencode_config should not be present when no bedrock options');
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
      assert.ok(result.provider, 'provider should be present');
      assert.strictEqual(result.provider.anthropic_api_key, 'sk-ant-key');
      assert.strictEqual(result.provider.openai_api_key, 'sk-openai-key');
      assert.strictEqual(result.provider.google_api_key, 'google-key');
      assert.ok(result.opencode_config, 'opencode_config should be present for bedrock');
      assert.strictEqual(result.opencode_config.provider['amazon-bedrock'].options.profile, 'my-profile');
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

  test('buildOpencodeConfig produces exact bedrock structure', () => {
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

  test('buildOpencodeConfig returns undefined when no bedrock options', () => {
    assert.strictEqual(buildOpencodeConfig({}), undefined);
  });

  test('buildOpencodeConfig returns undefined for API keys (not bedrock)', () => {
    assert.strictEqual(buildOpencodeConfig({ 'openai:api-key': 'sk-test' }), undefined);
    assert.strictEqual(buildOpencodeConfig({ 'anthropic:api-key': 'sk-ant-test' }), undefined);
    assert.strictEqual(buildOpencodeConfig({ 'google:api-key': 'google-test' }), undefined);
  });

  test('buildOpencodeConfig handles partial bedrock options', () => {
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

  test('buildProviderCredentials builds Anthropic credentials', () => {
    const result = buildProviderCredentials({ 'anthropic:api-key': 'sk-ant-test-key' });
    assert.deepStrictEqual(result, {
      anthropic_api_key: 'sk-ant-test-key',
    });
  });

  test('buildProviderCredentials builds OpenAI credentials', () => {
    const result = buildProviderCredentials({ 'openai:api-key': 'sk-openai-test-key' });
    assert.deepStrictEqual(result, {
      openai_api_key: 'sk-openai-test-key',
    });
  });

  test('buildProviderCredentials builds Google credentials', () => {
    const result = buildProviderCredentials({ 'google:api-key': 'google-test-key' });
    assert.deepStrictEqual(result, {
      google_api_key: 'google-test-key',
    });
  });

  test('buildProviderCredentials returns undefined when no API keys', () => {
    assert.strictEqual(buildProviderCredentials({}), undefined);
    assert.strictEqual(buildProviderCredentials({ 'amazon-bedrock:profile': 'test' }), undefined);
  });

  test('buildProviderCredentials combines all API keys', () => {
    const result = buildProviderCredentials({
      'anthropic:api-key': 'sk-ant-key',
      'openai:api-key': 'sk-openai-key',
      'google:api-key': 'google-key',
    });
    assert.deepStrictEqual(result, {
      anthropic_api_key: 'sk-ant-key',
      openai_api_key: 'sk-openai-key',
      google_api_key: 'google-key',
    });
  });
});
