import { getAuthToken, getProviderOptions } from '../configuration';
import { AgentConfig, BedrockOpencodeProvider, ProviderCredentials } from './agent-types';

export function buildProviderCredentials(opts: Record<string, string>): ProviderCredentials | undefined {
  const anthropicApiKey = opts['anthropic:api-key'];
  const openaiApiKey = opts['openai:api-key'];
  const googleApiKey = opts['google:api-key'];

  if (!anthropicApiKey && !openaiApiKey && !googleApiKey) {
    return undefined;
  }

  const credentials: ProviderCredentials = {};

  if (anthropicApiKey) {
    credentials.anthropic_api_key = anthropicApiKey;
  }

  if (openaiApiKey) {
    credentials.openai_api_key = openaiApiKey;
  }

  if (googleApiKey) {
    credentials.google_api_key = googleApiKey;
  }

  return credentials;
}

export function buildOpencodeConfig(opts: Record<string, string>): AgentConfig['opencode_config'] | undefined {
  const bedrockProfile = opts['amazon-bedrock:profile'];
  const bedrockRegion = opts['amazon-bedrock:region'];

  if (!bedrockProfile && !bedrockRegion) {
    return undefined;
  }

  const provider: BedrockOpencodeProvider = {
    'amazon-bedrock': {
      options: {
        ...(bedrockProfile && { profile: bedrockProfile }),
        ...(bedrockRegion && { region: bedrockRegion }),
      },
    },
  };

  return { provider };
}

export function buildAgentConfigWithToken(token: string, ioDir?: string): AgentConfig {
  if (!token) {
    throw new Error('No authentication token available for agent');
  }

  const providerOpts = getProviderOptions();
  const providerCredentials = buildProviderCredentials(providerOpts);
  const opencodeConfig = buildOpencodeConfig(providerOpts);

  return {
    codescene_access_token: token,
    plugins: ['render-code-fix-reporter'],
    tracking: { environment: 'codescene-vscode' },
    ...(ioDir && { io_json_dir: ioDir }),
    ...(providerCredentials && { provider: providerCredentials }),
    ...(opencodeConfig && { opencode_config: opencodeConfig }),
  };
}

export function buildAgentConfig(): AgentConfig {
  const token = getAuthToken();
  if (!token) {
    throw new Error('No authentication token available for agent');
  }
  return buildAgentConfigWithToken(token);
}

export function buildAgentConfigJson(): string {
  return JSON.stringify(buildAgentConfig());
}
