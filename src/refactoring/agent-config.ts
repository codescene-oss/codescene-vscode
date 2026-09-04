import { getAuthToken, getProviderOptions } from '../configuration';
import { AgentConfig } from './agent-types';

export function buildOpencodeConfig(opts: Record<string, string>): AgentConfig['opencode_config'] | undefined {
  const bedrockProfile = opts['amazon-bedrock:profile'];
  const bedrockRegion = opts['amazon-bedrock:region'];
  const hasBedrockOptions = bedrockProfile || bedrockRegion;

  if (!hasBedrockOptions) {
    return undefined;
  }

  return {
    provider: {
      ...(hasBedrockOptions && {
        'amazon-bedrock': {
          options: {
            ...(bedrockProfile && { profile: bedrockProfile }),
            ...(bedrockRegion && { region: bedrockRegion }),
          },
        },
      }),
    },
  };
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
