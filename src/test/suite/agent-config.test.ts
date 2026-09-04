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
});
