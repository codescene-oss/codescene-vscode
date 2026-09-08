import { getAuthToken, getProviderOptions } from '../configuration';
import { AgentConfig, ProviderConfig } from './agent-types';

export function buildOpencodeConfig(opts: Record<string, string>): AgentConfig['opencode_config'] | undefined {
  const bedrockProfile = opts['amazon-bedrock:profile'];
  const bedrockRegion = opts['amazon-bedrock:region'];
  const hasBedrockOptions = bedrockProfile || bedrockRegion;

  const anthropicApiKey = opts['anthropic:api-key'];
  const openaiApiKey = opts['openai:api-key'];
  const googleApiKey = opts['google:api-key'];

  const hasAnyOptions = hasBedrockOptions || anthropicApiKey || openaiApiKey || googleApiKey;

  if (!hasAnyOptions) {
    return undefined;
  }

  const provider: ProviderConfig = {};

  if (hasBedrockOptions) {
    provider['amazon-bedrock'] = {
      options: {
        ...(bedrockProfile && { profile: bedrockProfile }),
        ...(bedrockRegion && { region: bedrockRegion }),
      },
    };
  }

  if (anthropicApiKey) {
    provider.anthropic_api_key = anthropicApiKey;
  }

  if (openaiApiKey) {
    provider.openai_api_key = openaiApiKey;
  }

  if (googleApiKey) {
    provider.google_api_key = googleApiKey;
  }

  return { provider };
}

export function buildAgentConfigWithToken(token: string, ioDir?: string): AgentConfig {
  if (!token) {
    throw new Error('No authentication token available for agent');
  }

  const opencodeConfig = buildOpencodeConfig(getProviderOptions());

  return {
    codescene_access_token: token,
    plugins: ['render-code-fix-reporter'],
    ...(ioDir && { io_json_dir: ioDir }),
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
